// Functional tests owned by Wu Jiawei: accounts, friends and chat, meetings, pages, and local scheduling.
// Run from the project root: node server/test/functional.mjs
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(root, 'test-report')
fs.mkdirSync(outDir, { recursive: true })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reliatox-fn-'))
process.env.RELIATOX_DATA = tmp
process.env.ICE_SERVERS = '[{"urls":"stun:stun.example.com:19302"}]'

const { start } = await import('../index.js')
const WebSocket = (await import('ws')).default
const { server, port, hub } = await start({ port: 0, host: '127.0.0.1' })
const base = `http://127.0.0.1:${port}`

const cases = []
async function check(rec, fn) {
  const started = Date.now()
  try {
    const actual = await fn()
    cases.push({ ...rec, actual: actual || rec.expected, pass: true, ms: Date.now() - started })
    console.log(`  ✓ ${rec.id} ${rec.goal}`)
  } catch (error) {
    cases.push({ ...rec, actual: error.message, pass: false, ms: Date.now() - started })
    console.error(`  ✗ ${rec.id} ${rec.goal}: ${error.message}`)
  }
}

const post = async (url, body, token) => {
  const r = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  let data = null
  try { data = await r.json() } catch { data = null }
  return { status: r.status, body: data }
}
const get = async (url, token) => {
  const r = await fetch(base + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const text = await r.text()
  let body = text
  try { body = JSON.parse(text) } catch {}
  return { status: r.status, body, headers: Object.fromEntries(r.headers) }
}

class Peer {
  constructor(token) { this.token = token; this.events = []; this.waiters = []; this.rid = 1; this.pending = new Map() }
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${this.token}`)
    this.ws.on('message', (d, bin) => {
      if (bin) return
      const m = JSON.parse(d.toString())
      if (m.t === 'res') {
        const p = this.pending.get(m.rid)
        this.pending.delete(m.rid)
        return m.ok ? p.resolve(m.data) : p.reject(new Error(m.error))
      }
      this.events.push(m)
      this.waiters = this.waiters.filter((w) => !(w.test(m) && (w.resolve(m), true)))
    })
    this.hello = await this.waitFor((m) => m.t === 'hello')
    return this
  }
  waitFor(test, ms = 4000) {
    const hit = this.events.find(test)
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for an event')), ms)
      this.waiters.push({ test, resolve: (m) => (clearTimeout(t), resolve(m)) })
    })
  }
  req(t, payload = {}) {
    const rid = this.rid++
    return new Promise((resolve, reject) => {
      this.pending.set(rid, { resolve, reject })
      this.ws.send(JSON.stringify({ t, rid, ...payload }))
    })
  }
  chunk(id, offset, buf) {
    const h = Buffer.from(JSON.stringify({ t: 'file.chunk', id, offset }))
    const head = Buffer.alloc(4)
    head.writeUInt32BE(h.length)
    this.ws.send(Buffer.concat([head, h, buf]))
  }
  close() {
    return new Promise((r) => { this.ws.once('close', r); this.ws.close() })
  }
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const toxOk = (id) => {
  assert.match(id, /^[0-9A-F]{76}$/)
  const raw = Buffer.from(id, 'hex')
  const body = raw.subarray(0, 36)
  const cs = Buffer.alloc(2)
  for (let i = 0; i < body.length; i++) cs[i % 2] ^= body[i]
  assert.equal(cs.toString('hex').toUpperCase(), id.slice(72))
}

try {
  console.log('Accounts and sessions')
  await check({
    id: 'FN-ACC-01', module: 'Account', goal: 'A legal username and a 6-character password can register',
    pre: 'Empty temporary database', steps: 'POST /api/register username=ab password=123456',
    expected: '200, with a token and a 76-character ID whose checksum is valid',
  }, async () => {
    const r = await post('/api/register', { username: 'ab', password: '123456' })
    assert.equal(r.status, 200)
    toxOk(r.body.user.toxId)
    return `200. ID checksum passed ${r.body.user.toxId.slice(0, 8)}…`
  })
  await check({
    id: 'FN-ACC-02', module: 'Account', goal: 'Username length and character classes',
    pre: 'Server is running', steps: 'Register names of length 1 and 21, names with a space or a symbol, a 20-character name, Chinese, underscore, and hyphen',
    expected: 'Illegal names return 400; the 20-character name, Chinese, underscore, and hyphen return 200',
  }, async () => {
    const bad = ['a', 'a'.repeat(21), 'a b', 'ab!', '']
    for (const username of bad) {
      const r = await post('/api/register', { username, password: '123456' })
      assert.equal(r.status, 400, `should reject ${JSON.stringify(username)}`)
    }
    for (const username of ['u'.repeat(20), '测试', 'ab_cd', 'ab-cd']) {
      const r = await post('/api/register', { username, password: '123456' })
      assert.equal(r.status, 200, `should accept ${username}`)
    }
    return 'Five illegal names returned 400. Four legal names returned 200.'
  })
  await check({
    id: 'FN-ACC-03', module: 'Account', goal: 'Password length boundary',
    pre: 'Username is unused', steps: 'Register once with a 5-character password and once with 6',
    expected: '5 characters return 400; 6 characters return 200',
  }, async () => {
    const short = await post('/api/register', { username: 'pw5', password: '12345' })
    const ok = await post('/api/register', { username: 'pw6', password: '123456' })
    assert.equal(short.status, 400)
    assert.equal(ok.status, 200)
    return '5 characters returned 400. 6 characters returned 200.'
  })
  await check({
    id: 'FN-ACC-04', module: 'Account', goal: 'Login, session, and logout',
    pre: 'User ab already exists', steps: 'Wrong password, wrong user, correct login, GET /api/me, POST /api/logout, then reuse the old token',
    expected: 'Errors are 401; success is 200; the old token is invalid after logout',
  }, async () => {
    const wrong = await post('/api/login', { username: 'ab', password: 'wrong!' })
    const missing = await post('/api/login', { username: 'nobody', password: '123456' })
    const ok = await post('/api/login', { username: 'AB', password: '123456' })
    const me = await get('/api/me', ok.body.token)
    const anon = await get('/api/me')
    await post('/api/logout', {}, ok.body.token)
    const gone = await get('/api/me', ok.body.token)
    assert.equal(wrong.status, 401)
    assert.equal(missing.status, 401)
    assert.equal(ok.status, 200)
    assert.equal(me.body.user.username, 'ab')
    assert.equal(anon.status, 401)
    assert.equal(gone.status, 401)
    return 'Wrong login returned 401. Correct login and /api/me returned 200. The old token returned 401 after logout.'
  })
  await check({
    id: 'FN-ACC-05', module: 'Account', goal: 'The database does not store a plaintext password',
    pre: 'A user is registered', steps: 'Read the temporary db.json',
    expected: 'The file does not contain 123456 and does contain salt and hash',
  }, async () => {
    await new Promise((r) => setTimeout(r, 250))
    const text = fs.readFileSync(path.join(tmp, 'db.json'), 'utf8')
    assert.equal(text.includes('123456'), false)
    assert.match(text, /"salt":/)
    assert.match(text, /"hash":/)
    return 'db.json has no plaintext password. salt and hash are present.'
  })
  await check({
    id: 'FN-ACC-06', module: 'Account', goal: 'Illegal JSON and an unknown route',
    pre: 'Server is running', steps: 'POST a non-JSON body; GET /api/nope',
    expected: '400 and 404 respectively',
  }, async () => {
    const r = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    const missing = await get('/api/nope')
    assert.equal(r.status, 400)
    assert.equal(missing.status, 404)
    return 'Illegal JSON returned 400. The unknown route returned 404.'
  })

  const alice = (await post('/api/register', { username: 'alice', password: 'alicepw' })).body
  const bob = (await post('/api/register', { username: 'bob', password: 'bobpass' })).body
  const carol = (await post('/api/register', { username: 'carol', password: 'carolpw' })).body
  const A = await new Peer(alice.token).open()
  const B = await new Peer(bob.token).open()

  console.log('Friends, chat, and offline messages')
  await check({
    id: 'FN-CHAT-01', module: 'Friends and chat', goal: 'Add a friend by username; a repeat add does not create a second relationship',
    pre: 'alice and bob are online and are not friends yet', steps: 'friend.add query=BoB, then add again',
    expected: 'The first reply has already=false; the second has already=true; bob receives the friend list',
  }, async () => {
    const first = await A.req('friend.add', { query: 'BoB' })
    const seen = await B.waitFor((m) => m.t === 'friends' && m.friends.some((f) => f.username === 'alice'))
    const second = await A.req('friend.add', { query: 'bob' })
    assert.equal(first.already, false)
    assert.equal(second.already, true)
    assert.equal(seen.friends.length, 1)
    return 'The username match ignores case. The repeat add returned already=true.'
  })
  await check({
    id: 'FN-CHAT-02', module: 'Friends and chat', goal: 'A 76-character ID and a 64-character prefix both find the user',
    pre: 'carol is registered and is not yet friends with alice', steps: 'Add by the full ID, then resolve the 64-character prefix alone',
    expected: 'The add succeeds; the 64-character prefix points at the same toxId',
  }, async () => {
    const added = await A.req('friend.add', { query: carol.user.toxId })
    assert.equal(added.friend.username, 'carol')
    const prefix = carol.user.toxId.slice(0, 64)
    const again = await B.req('friend.add', { query: prefix })
    assert.equal(again.friend.toxId, carol.user.toxId)
    return 'Both the full ID and the 64-character prefix resolved to carol.'
  })
  await check({
    id: 'FN-CHAT-03', module: 'Friends and chat', goal: 'A missing user and oneself cannot be added',
    pre: 'alice is online', steps: 'friend.add ghost, and friend.add with alice\'s own username',
    expected: 'Both attempts fail',
  }, async () => {
    await assert.rejects(A.req('friend.add', { query: 'ghost' }), /not found/i)
    await assert.rejects(A.req('friend.add', { query: 'alice' }), /yourself/i)
    return 'The missing user returned User not found. Adding oneself was rejected.'
  })
  await check({
    id: 'FN-CHAT-04', module: 'Friends and chat', goal: 'An empty message is rejected; an over-long message is cut to 4000',
    pre: 'alice and bob are friends', steps: 'Send an empty string, then send 4001 a\'s',
    expected: 'The empty string fails; the stored text length is 4000',
  }, async () => {
    await assert.rejects(A.req('msg.send', { to: bob.user.id, text: '   ' }), /empty/i)
    const sent = await A.req('msg.send', { to: bob.user.id, text: 'a'.repeat(4001) })
    assert.equal(sent.msg.text.length, 4000)
    const got = await B.waitFor((m) => m.t === 'msg' && m.msg.text.length === 4000)
    assert.equal(got.msg.text, 'a'.repeat(4000))
    return 'The empty message was rejected. 4001 characters were stored as 4000.'
  })
  await check({
    id: 'FN-CHAT-05', module: 'Friends and chat', goal: 'A message sent while the peer is offline can be read after reconnect',
    pre: 'The two users are friends', steps: 'Close bob, alice sends, bob reconnects with the same token and requests history',
    expected: 'bob receives no live event while offline; the message is in history after reconnect',
  }, async () => {
    await B.close()
    await A.req('msg.send', { to: bob.user.id, text: 'offline-note' })
    const B2 = await new Peer(bob.token).open()
    const live = B2.events.find((m) => m.t === 'msg' && m.msg.text === 'offline-note')
    const hist = await B2.req('history', { with: alice.user.id })
    assert.equal(live, undefined)
    assert.ok(hist.messages.some((m) => m.text === 'offline-note'))
    Object.assign(B, B2)
    return 'The offline message was not pushed live. history returned it.'
  })
  await check({
    id: 'FN-CHAT-06', module: 'Friends and chat', goal: 'A non-friend cannot read history',
    pre: 'alice and a newly registered user who is not a friend', steps: 'The new user requests history with alice',
    expected: 'The request fails',
  }, async () => {
    const dave = (await post('/api/register', { username: 'dave', password: 'davepw' })).body
    const D = await new Peer(dave.token).open()
    await assert.rejects(D.req('history', { with: alice.user.id }), /friend/i)
    await D.close()
    return 'Reading history as a non-friend was rejected.'
  })

  console.log('Meeting signaling')
  await check({
    id: 'FN-MEET-01', module: 'Meeting', goal: 'Meeting-code alphabet, leaving, and an offline invite',
    pre: 'alice is in a meeting; bob is online and then disconnects', steps: 'Create a meeting, invite online bob, bob leaves, then invite offline bob',
    expected: 'The code uses the unambiguous alphabet; leaving is announced; the offline invite has delivered=false',
  }, async () => {
    const created = await A.req('meet.create', { title: 'functional test' })
    assert.match(created.room.id, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    const online = await A.req('meet.invite', { room: created.room.id, to: bob.user.id })
    assert.equal(online.delivered, true)
    await B.req('meet.join', { room: created.room.id })
    await B.req('meet.leave')
    const left = await A.waitFor((m) => m.t === 'meet.peer-left')
    assert.ok(left.peerId)
    await B.close()
    const offline = await A.req('meet.invite', { room: created.room.id, to: bob.user.id })
    assert.equal(offline.delivered, false)
    const frank = (await post('/api/register', { username: 'frank', password: 'frankpw' })).body
    await assert.rejects(A.req('meet.invite', { room: created.room.id, to: frank.user.id }), /friend/i)
    return `Meeting code ${created.room.id}. The online invite was delivered, leaving was announced, and the offline invite had delivered=false.`
  })
  await check({
    id: 'FN-MEET-02', module: 'Meeting', goal: 'A ninth person cannot join',
    pre: 'Seven more users can be registered', steps: 'Eight people including the creator join; a ninth person joins',
    expected: 'The first eight succeed; the ninth receives a room-full error',
  }, async () => {
    const host = await post('/api/register', { username: 'host', password: 'hostpw' })
    const H = await new Peer(host.body.token).open()
    const room = await H.req('meet.create', { title: 'capacity' })
    const peers = []
    for (let i = 1; i <= 7; i++) {
      const u = await post('/api/register', { username: `p${i}`, password: '123456' })
      const peer = await new Peer(u.body.token).open()
      await peer.req('meet.join', { room: room.room.id })
      peers.push(peer)
    }
    const ninth = await post('/api/register', { username: 'p9', password: '123456' })
    const N = await new Peer(ninth.body.token).open()
    await assert.rejects(N.req('meet.join', { room: room.room.id }), /full/i)
    await N.close()
    for (const peer of peers) await peer.close()
    await H.close()
    return 'Eight people entered. The ninth was rejected.'
  })
  await check({
    id: 'FN-MEET-03', module: 'Meeting', goal: 'hello carries ICE settings, and ping returns pong',
    pre: 'The server is started with ICE_SERVERS', steps: 'Read hello, then send ping',
    expected: 'iceServers matches the environment variable, and a pong arrives',
  }, async () => {
    assert.equal(A.hello.iceServers[0].urls, 'stun:stun.example.com:19302')
    A.ws.send(JSON.stringify({ t: 'ping', n: 7 }))
    const pong = await A.waitFor((m) => m.t === 'pong' && m.n === 7)
    assert.equal(pong.n, 7)
    return 'hello.iceServers was correct. pong.n=7.'
  })

  console.log('Static page and local scheduling')
  await check({
    id: 'FN-WEB-01', module: 'Page', goal: 'The built page opens, and a traversal path does not read a file outside the project',
    pre: 'dist/index.html exists', steps: 'GET / and an encoded traversal path',
    expected: 'The home page is 200 and contains ReliaTox; the traversal request does not return the body of package.json',
  }, async () => {
    const home = await get('/')
    const sneak = await get('/..%2fpackage.json')
    assert.equal(home.status, 200)
    assert.match(String(home.body), /ReliaTox/)
    assert.equal(String(sneak.body).includes('"reliatox-web"'), false)
    return 'The home page was 200. The traversal path did not return package.json.'
  })

  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { concurrencyLimit, buildLocalPlan } = await import('../../src/net/transfers.js')
  const { setState } = await import('../../src/net/store.js')
  const { formatBytes, exactBytes, shortHash } = await import('../../src/lib/format.js')

  await check({
    id: 'FN-SCH-01', module: 'Local scheduling', goal: 'Concurrency limits for three policies and a poor link',
    pre: 'DeepSeek is not called', steps: 'Compute limits for speed, fair, and save, a poor link, and adaptive concurrency',
    expected: 'speed=4, fair=3, save=1; poor-link speed drops to 2; the adaptive value does not exceed the policy limit',
  }, async () => {
    assert.equal(concurrencyLimit({ policy: 'speed', quality: '好', adaptiveConcurrency: null }), 4)
    assert.equal(concurrencyLimit({ policy: 'fair', quality: '好', adaptiveConcurrency: null }), 3)
    assert.equal(concurrencyLimit({ policy: 'save', quality: '好', adaptiveConcurrency: null }), 1)
    assert.equal(concurrencyLimit({ policy: 'speed', quality: '差', adaptiveConcurrency: null }), 2)
    assert.equal(concurrencyLimit({ policy: 'speed', quality: '好', adaptiveConcurrency: 9 }), 4)
    assert.equal(concurrencyLimit({ policy: 'fair', quality: '差', adaptiveConcurrency: 3 }), 1)
    return 'All six concurrency limits matched the rules.'
  })
  await check({
    id: 'FN-SCH-02', module: 'Local scheduling', goal: 'A poor link with no local file handle gets a safe fallback',
    pre: 'DeepSeek is not called', steps: 'Build one interrupted transfer whose page has no original file, with poor link quality',
    expected: 'No resume action is produced; the plan asks the user to pick the file again and suggests power saving',
  }, async () => {
    setState({
      me: { id: 'u1' }, quality: '差', rtt: 320, policy: 'speed',
      transfers: { a: { id: 'a', from: 'u1', name: 'a.bin', size: 100, confirmed: 40, state: 'interrupted' } },
    })
    const plan = buildLocalPlan('DEEPSEEK_API_KEY is not configured on the server')
    assert.equal(plan.source, 'local')
    assert.equal(plan.actions.some((a) => a.type === 'resume'), false)
    assert.equal(plan.actions.some((a) => a.type === 'policy' && a.policy === 'save'), true)
    assert.match(plan.items.join('\n'), /original file/i)
    return 'The local plan required picking the file again and lowered the policy to power saving.'
  })
  await check({
    id: 'FN-SCH-03', module: 'Local scheduling', goal: 'An empty task list proposes no change',
    pre: 'The transfer list is empty', steps: 'Call buildLocalPlan',
    expected: 'The action list is empty, and the plan says no change is needed',
  }, async () => {
    setState({ me: { id: 'u1' }, quality: '好', policy: 'fair', transfers: {} })
    const plan = buildLocalPlan()
    assert.deepEqual(plan.actions, [])
    assert.match(plan.items[0], /No transfer adjustments/)
    return 'The empty list returned one note that no adjustment was needed.'
  })
  await check({
    id: 'FN-SCH-04', module: 'Display format', goal: 'Boundaries for bytes, exact numbers, and fingerprint abbreviations',
    pre: 'None', steps: 'Format 0, 1023, 1024, 1MiB, 1GiB, and a 64-character fingerprint',
    expected: 'Unit changes are correct; the abbreviation keeps 8 characters at each end',
  }, async () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1023), '1023 B')
    assert.equal(formatBytes(1024), '1.0 KB')
    assert.equal(formatBytes(1024 ** 2), '1.00 MB')
    assert.equal(formatBytes(1024 ** 3), '1.00 GB')
    assert.equal(exactBytes(1507328), '1,507,328 B')
    assert.equal(shortHash('a'.repeat(64)), 'aaaaaaaa…aaaaaaaa')
    return 'Byte units, thousands separators, and the fingerprint abbreviation matched the expected text.'
  })

  const home = await get('/')
  assert.equal(home.status, 200)
} finally {
  const passed = cases.filter((c) => c.pass).length
  const failed = cases.length - passed
  const summary = { total: cases.length, passed, failed, generatedAt: new Date().toISOString(), dataDir: tmp }
  fs.writeFileSync(path.join(outDir, 'wu-functional-results.json'), JSON.stringify({ summary, cases }, null, 2))
  console.log(`\nFunctional tests ${passed}/${cases.length} passed`)
  server.close()
  await new Promise((r) => setTimeout(r, 250))
  fs.rmSync(tmp, { recursive: true, force: true })
  setTimeout(() => process.exit(failed ? 1 : 0), 100)
}

void hub
void sha
