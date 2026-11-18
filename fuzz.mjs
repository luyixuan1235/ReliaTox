// Fuzz testing: send malformed HTTP requests, WebSocket frames, and binary frames to a local temporary server.
// DeepSeek is not called. A crash, a hung request, or a 5xx response is a failure.
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

delete process.env.DEEPSEEK_API_KEY
const SEED = 20261116
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reliatox-fuzz-'))
process.env.RELIATOX_DATA = tmp
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outFile = path.join(root, 'test-report', 'fuzz-results.json')
fs.mkdirSync(path.dirname(outFile), { recursive: true })

const crashes = []
const findings = []
const log = (text) => fs.writeSync(1, text + '\n')
function finish(code) {
  const summary = {
    seed: SEED,
    sent,
    crashes: crashes.length,
    findings: findings.length,
    passed: code === 0,
    generatedAt: new Date().toISOString(),
  }
  try { fs.writeFileSync(outFile, JSON.stringify({ summary, crashes, findings }, null, 2)) } catch {}
  log(`Fuzz ${summary.passed ? 'passed' : 'failed'}: sent ${sent}, crashes ${crashes.length}, bad responses ${findings.length}`)
  if (crashes[0]) log(String(crashes[0].message).split('\n').slice(0, 6).join('\n'))
  if (findings[0]) log(`Example: ${findings[0].area} ${findings[0].input} ${findings[0].actual}`)
  process.exit(code)
}
process.on('uncaughtException', (error) => {
  crashes.push({ kind: 'uncaughtException', message: error.stack || error.message })
  log('Crash: ' + error.message)
  finish(1)
})
process.on('unhandledRejection', (error) => {
  crashes.push({ kind: 'unhandledRejection', message: error?.stack || String(error) })
  log('Unhandled rejection: ' + (error?.message || error))
  finish(1)
})

const { start } = await import('../index.js')
const WebSocket = (await import('ws')).default
const { server, port } = await start({ port: 0, host: '127.0.0.1' })
const base = `http://127.0.0.1:${port}`

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(SEED)
const pick = (list) => list[Math.floor(rnd() * list.length)]
const weird = () => pick([
  null, 0, -1, 1.5, true, false, '', ' ', 'a', '%', '../', '..%2f', '\u0000',
  'a'.repeat(300), '测'.repeat(40), [], {}, { x: 1 }, ['nope'],
])

let sent = 0
const note = (area, input, actual, bad) => {
  sent++
  if (bad) findings.push({ area, input: String(input).slice(0, 240), actual: String(actual).slice(0, 400) })
}

async function http(method, urlPath, { body, token, raw = false } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)
  try {
    const r = await fetch(base + urlPath, {
      method,
      headers: {
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await r.text()
    return { status: r.status, text }
  } catch (error) {
    return { status: 0, text: error.name === 'AbortError' ? 'timeout' : error.message }
  } finally {
    clearTimeout(timer)
  }
}
const badHttp = (res) => res.status === 0 || res.status >= 500

const reg = await http('POST', '/api/register', { body: { username: 'fuzz', password: 'fuzzpw' } })
if (reg.status !== 200) throw new Error('could not prepare the fuzz account: ' + reg.text)
const alice = JSON.parse(reg.text)
const bobReg = await http('POST', '/api/register', { body: { username: 'fuzzbob', password: 'fuzzpw' } })
const bob = JSON.parse(bobReg.text)

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${alice.token}`)
const frames = []
ws.on('message', (d, bin) => { if (!bin) frames.push(d.toString()) })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 3000)
  ws.once('open', () => { clearTimeout(timer); resolve() })
  ws.once('error', (error) => { clearTimeout(timer); reject(error) })
})
const helloRaw = await new Promise((resolve, reject) => {
  const hit = frames.find((f) => f.includes('"hello"'))
  if (hit) return resolve(hit)
  const timer = setTimeout(() => reject(new Error('hello was not received')), 2000)
  ws.on('message', (d, bin) => {
    if (bin) return
    const text = d.toString()
    if (text.includes('"hello"')) {
      clearTimeout(timer)
      resolve(text)
    }
  })
})
const hello = JSON.parse(helloRaw)
await new Promise((resolve, reject) => {
  const rid = 1
  const timer = setTimeout(() => reject(new Error('adding a friend timed out')), 2000)
  const onMsg = (d, bin) => {
    if (bin) return
    let m
    try { m = JSON.parse(d.toString()) } catch { return }
    if (m.t === 'res' && m.rid === rid) {
      clearTimeout(timer)
      ws.off('message', onMsg)
      m.ok ? resolve(m) : reject(new Error(m.error))
    }
  }
  ws.on('message', onMsg)
  ws.send(JSON.stringify({ t: 'friend.add', rid, query: 'fuzzbob' }))
})

log('HTTP')
const httpCases = [
  ['GET', '/%'],
  ['GET', '/%2'],
  ['GET', '/%GG'],
  ['GET', '/%E0%A4'],
  ['GET', '/%FF%FE'],
  ['GET', '/%c0%af../package.json'],
  ['GET', '/%00'],
  ['GET', '/..%2fpackage.json'],
  ['POST', '/api/register', { body: null }],
  ['POST', '/api/register', { body: [] }],
  ['POST', '/api/register', { body: { username: null, password: null } }],
  ['POST', '/api/register', { body: { username: 12, password: { a: 1 } } }],
  ['POST', '/api/register', { body: { username: 'ab', password: '12345' } }],
  ['POST', '/api/register', { raw: true, body: '{' }],
  ['POST', '/api/register', { raw: true, body: '' }],
  ['POST', '/api/login', { body: { username: { a: 1 }, password: [] } }],
  ['POST', '/api/login', { body: { username: 'nope', password: '123456' } }],
  ['GET', '/api/me', { token: '%%%' }],
  ['GET', '/api/me'],
  ['POST', '/api/logout', { token: null }],
  ['GET', '/api/files/' + 'g'.repeat(64), { token: alice.token }],
  ['GET', '/api/files/not-a-hash', { token: alice.token }],
  ['POST', '/api/nope', { body: { a: weird() } }],
  ['GET', '/api/%'],
]
for (let i = 0; i < 24; i++) {
  httpCases.push(['GET', `/${pick(['%', '%2', '%GG', 'ok', '..%2f', '%E0%A4'])}${i}`])
  httpCases.push(['POST', '/api/register', { body: { username: weird(), password: weird() } }])
}
for (const [method, urlPath, opt = {}] of httpCases) {
  const res = await http(method, urlPath, opt)
  note('http', `${method} ${urlPath}`, `${res.status} ${res.text}`, badHttp(res))
  if (crashes.length || findings.length > 8) break
}

log('WebSocket')
const types = ['ping', 'friend.add', 'msg.send', 'history', 'file.offer', 'file.accept', 'file.cancel', 'file.start', 'file.finish', 'meet.create', 'meet.join', 'meet.leave', 'meet.signal', 'meet.state', 'meet.invite', 'nope', '']
let rid = 2
const sendJson = (obj) => ws.send(JSON.stringify(obj))
for (let i = 0; i < 80; i++) {
  const type = pick(types)
  const msg = {
    t: type,
    rid,
    query: weird(),
    to: pick([bob.user.id, alice.user.id, weird(), null]),
    text: weird(),
    with: weird(),
    id: pick(['g'.repeat(64), weird()]),
    name: weird(),
    size: weird(),
    sha256: pick(['a'.repeat(64), weird()]),
    room: weird(),
    title: weird(),
    state: weird(),
    data: weird(),
    n: weird(),
  }
  if (rnd() < 0.15) delete msg.rid
  try {
    sendJson(rnd() < 0.1 ? weird() : msg)
    note('ws', type || '(empty type)', 'sent', false)
  } catch (error) {
    note('ws', type, error.message, true)
  }
  rid++
}
for (const raw of ['', 'null', '[]', '"x"', '{', '{]', '%%%']) {
  try {
    ws.send(raw)
    note('ws-raw', raw || '(empty)', 'sent', false)
  } catch (error) {
    note('ws-raw', raw, error.message, true)
  }
}

log('Binary frames')
const badBins = [
  Buffer.alloc(0),
  Buffer.from([0, 0, 0, 1]),
  Buffer.from([0xff, 0xff, 0xff, 0xff, 1]),
  Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from('{}')]),
]
const header = Buffer.from(JSON.stringify({ t: 'file.chunk', id: 'g'.repeat(64), offset: pick([0, -1, 1.5, '0', null]) }))
const head = Buffer.alloc(4)
head.writeUInt32BE(header.length)
badBins.push(Buffer.concat([head, header, crypto.randomBytes(8)]))
badBins.push(Buffer.concat([head, Buffer.from('{'), crypto.randomBytes(4)]))
for (const buf of badBins) {
  try {
    ws.send(buf)
    note('binary', `len=${buf.length}`, 'sent', false)
  } catch (error) {
    note('binary', `len=${buf.length}`, error.message, true)
  }
}

await new Promise((r) => setTimeout(r, 300))
const alive = await http('GET', '/')
note('health', 'GET /', `${alive.status} ${alive.text.slice(0, 40)}`, alive.status !== 200)
let pong = false
try {
  const before = frames.length
  ws.send(JSON.stringify({ t: 'ping', n: 42 }))
  await new Promise((r) => setTimeout(r, 200))
  pong = frames.slice(before).some((f) => f.includes('"pong"') && f.includes('42'))
} catch (error) {
  note('health', 'ping', error.message, true)
}
if (!pong) note('health', 'ping 42', frames.slice(-3).join(' | ') || 'no pong', true)

ws.close()
server.close()
finish(crashes.length === 0 && findings.length === 0 ? 0 : 1)
void hello
