import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(root, 'test-report')
fs.mkdirSync(outDir, { recursive: true })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reliatox-file-'))
process.env.RELIATOX_DATA = tmp
delete process.env.DEEPSEEK_API_KEY

const { start } = await import('../index.js')
const WebSocket = (await import('ws')).default
const { server, port } = await start({ port: 0, host: '127.0.0.1' })
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
  return { status: r.status, body }
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
  waitFor(test, ms = 8000) {
    const hit = this.events.find(test)
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Event wait timeout')), ms)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const alice = (await post('/api/register', { username: 'alice', password: 'alicepw' })).body
  const bob = (await post('/api/register', { username: 'bob', password: 'bobpass' })).body
  const carol = (await post('/api/register', { username: 'carol', password: 'carolpw' })).body
  const A = await new Peer(alice.token).open()
  const B = await new Peer(bob.token).open()
  await A.req('friend.add', { query: bob.user.toxId })
  await B.waitFor((m) => m.t === 'friends' && m.friends.some((f) => f.username === 'alice'))

  console.log('File Transfer')
  await check({
    id: 'FN-FILE-01', module: 'File Transfer', goal: 'File name path characters are sanitized; the same file obtains the same ID',
    pre: 'Alice and Bob are friends', steps: 'Offer ../../secret?.bin twice, size 4, same fingerprint',
    expected: 'File name contains no path or question mark; IDs are identical for both offers',
  }, async () => {
    const digest = sha(Buffer.from('file'))
    const a = await A.req('file.offer', { to: bob.user.id, name: '../../secret?.bin', size: 4, sha256: digest })
    const b = await A.req('file.offer', { to: bob.user.id, name: '../../secret?.bin', size: 4, sha256: digest })
    assert.equal(a.transfer.name.includes('/'), false)
    assert.equal(a.transfer.name.includes('?'), false)
    assert.equal(a.transfer.id, b.transfer.id)
    return `Sanitized file name is ${a.transfer.name}, both IDs match`
  })
  await check({
    id: 'FN-FILE-02', module: 'File Transfer', goal: 'File size boundary checks and invalid SHA-256 fingerprint validation',
    pre: 'Both users are friends', steps: 'Offer files of size 0, 1, 20GiB, 20GiB+1, and an invalid SHA-256 hash',
    expected: 'Size 0, oversized files and invalid fingerprints are rejected; 1-byte and 20GiB offers succeed',
  }, async () => {
    const digest = sha(Buffer.from('x'))
    const max = 20 * 1024 ** 3
    await assert.rejects(A.req('file.offer', { to: bob.user.id, name: 'z.bin', size: 0, sha256: digest }), /size/i)
    await assert.rejects(A.req('file.offer', { to: bob.user.id, name: 'over.bin', size: max + 1, sha256: digest }), /size/i)
    await assert.rejects(A.req('file.offer', { to: bob.user.id, name: 'h.bin', size: 1, sha256: 'abc' }), /fingerprint/i)
    const one = await A.req('file.offer', { to: bob.user.id, name: 'one.bin', size: 1, sha256: digest })
    const big = await A.req('file.offer', { to: bob.user.id, name: 'max.bin', size: max, sha256: digest })
    assert.equal(one.transfer.state, 'offered')
    assert.equal(big.transfer.size, max)
    return 'Zero-byte, oversized and invalid-fingerprint offers are rejected; 1-byte and 20GiB offers can be created'
  })
  await check({
    id: 'FN-FILE-03', module: 'File Transfer', goal: 'Non-friends cannot send files; receivers cannot initiate transmission on behalf of sender',
    pre: 'Two users are not mutual friends', steps: 'Send file offer to non-friend; receiver calls file.start',
    expected: 'Both operations fail',
  }, async () => {
    const digest = sha(Buffer.from('x'))
    const erin = (await post('/api/register', { username: 'erin', password: 'erinpw' })).body
    await assert.rejects(A.req('file.offer', { to: erin.user.id, name: 'x.bin', size: 1, sha256: digest }), /friend/i)
    const offer = await A.req('file.offer', { to: bob.user.id, name: 'role.bin', size: 1, sha256: digest })
    await B.req('file.accept', { id: offer.transfer.id })
    await assert.rejects(B.req('file.start', { id: offer.transfer.id }), /not found/i)
    return 'Offer to non-friend rejected; receiver cannot invoke file.start'
  })
  await check({
    id: 'FN-FILE-04', module: 'File Transfer', goal: 'Incomplete transfer cannot be finished; canceled transfer cannot be downloaded as completed',
    pre: 'An accepted but unfinished file transfer exists', steps: 'Call finish directly; cancel transfer; attempt download',
    expected: 'finish fails; state becomes canceled after cancel; download returns 409',
  }, async () => {
    const raw = Buffer.from('12345678')
    const offer = await A.req('file.offer', { to: bob.user.id, name: 'part.bin', size: raw.length, sha256: sha(raw) })
    await B.req('file.accept', { id: offer.transfer.id })
    await A.req('file.start', { id: offer.transfer.id })
    A.chunk(offer.transfer.id, 0, raw.subarray(0, 4))
    await A.waitFor((m) => m.t === 'file.progress' && m.id === offer.transfer.id && m.confirmed === 4)
    await assert.rejects(A.req('file.finish', { id: offer.transfer.id }), /incomplete/i)
    const canceled = await B.req('file.cancel', { id: offer.transfer.id })
    assert.equal(canceled.transfer.state, 'canceled')
    const dl = await get(`/api/files/${offer.transfer.id}`, bob.token)
    assert.equal(dl.status, 409)
    return 'finish on incomplete transfer rejected; download returns 409 after cancellation'
  })
  await check({
    id: 'FN-FILE-05', module: 'File Transfer', goal: 'Re-offer with identical metadata after cancellation clears old progress',
    pre: 'Previous file with same fingerprint was canceled in FN-FILE-04', steps: 'Re-offer with same metadata and start transfer',
    expected: 'confirmed offset resets to 0, transfer ready to restart',
  }, async () => {
    const raw = Buffer.from('12345678')
    const offer = await A.req('file.offer', { to: bob.user.id, name: 'part.bin', size: raw.length, sha256: sha(raw) })
    assert.equal(offer.transfer.confirmed, 0)
    assert.equal(offer.transfer.state, 'offered')
    await B.req('file.accept', { id: offer.transfer.id })
    const st = await A.req('file.start', { id: offer.transfer.id })
    assert.equal(st.transfer.confirmed, 0)
    await A.req('file.cancel', { id: offer.transfer.id })
    return 'Confirmed offset resets to zero after re-offer'
  })
  await check({
    id: 'FN-FILE-06', module: 'File Transfer', goal: 'The same file cannot be sent concurrently from two client windows',
    pre: 'Alice has two active connections; file offer is accepted', steps: 'Call file.start from both connections',
    expected: 'The second start request is rejected',
  }, async () => {
    const raw = Buffer.from('abcdefgh')
    const offer = await A.req('file.offer', { to: bob.user.id, name: 'lock.bin', size: raw.length, sha256: sha(raw) })
    await B.req('file.accept', { id: offer.transfer.id })
    const A2 = await new Peer(alice.token).open()
    await A.req('file.start', { id: offer.transfer.id })
    await assert.rejects(A2.req('file.start', { id: offer.transfer.id }), /another window/i)
    await A.req('file.cancel', { id: offer.transfer.id })
    await A2.close()
    return 'Transmission from the second window is rejected'
  })
  await check({
    id: 'FN-FILE-07', module: 'File Transfer', goal: 'Sender and receiver may download completed file; third parties cannot',
    pre: 'A 1-byte file can finish transmission', steps: 'Download by sender, receiver and an unrelated third user after completion',
    expected: 'Sender and receiver get 200 response with matching bytes; third party gets 404',
  }, async () => {
    const raw = Buffer.from('Z')
    const offer = await A.req('file.offer', { to: bob.user.id, name: 'z.txt', size: 1, sha256: sha(raw) })
    await B.req('file.accept', { id: offer.transfer.id })
    await A.req('file.start', { id: offer.transfer.id })
    A.chunk(offer.transfer.id, 0, raw)
    await A.waitFor((m) => m.t === 'file.progress' && m.id === offer.transfer.id && m.confirmed === 1)
    const fin = await A.req('file.finish', { id: offer.transfer.id })
    assert.equal(fin.transfer.hashOk, true)
    const fromSender = await get(`/api/files/${offer.transfer.id}`, alice.token)
    const fromBob = await get(`/api/files/${offer.transfer.id}`, bob.token)
    const stranger = await get(`/api/files/${offer.transfer.id}`, carol.token)
    assert.equal(fromSender.status, 200)
    assert.equal(fromSender.body, 'Z')
    assert.equal(fromBob.status, 200)
    assert.equal(stranger.status, 404)
    await assert.rejects(A.req('file.cancel', { id: offer.transfer.id }), /cannot be canceled/i)
    return 'Sender and receiver download content Z; outsider receives 404; completed file cannot be canceled'
  })

  console.log('Resumable Transmission')
  const SIZE = 3 * 1024 * 1024 + 12345
  const data = crypto.randomBytes(SIZE)
  const digest = sha(data)
  const CH = 64 * 1024
  const HALF = 1024 * 1024 + 7 * CH
  let id
  await check({
    id: 'E2E-13', module: 'File Transfer', goal: 'Offer generates valid file ID',
    pre: 'Users are mutual friends', steps: 'Offer an approximately 3MB file',
    expected: '64-character hex ID, state = offered',
  }, async () => {
    const o = await A.req('file.offer', { to: bob.user.id, name: 'big.bin', size: SIZE, sha256: digest })
    id = o.transfer.id
    assert.match(id, /^[0-9a-f]{64}$/)
    assert.equal(o.transfer.state, 'offered')
    return 'Offer generates 32-byte file id, state offered'
  })
  await check({
    id: 'E2E-14', module: 'File Transfer', goal: 'Transmission cannot start before receiver accepts offer',
    pre: 'File state is offered', steps: 'Invoke file.start',
    expected: 'Operation fails',
  }, async () => {
    await assert.rejects(A.req('file.start', { id }), /state/i)
    return 'Transmission cannot start before receiver accepts'
  })
  await check({
    id: 'E2E-15', module: 'Resumable Transmission', goal: 'Server confirms received offset after partial upload',
    pre: 'Receiver has accepted the file offer', steps: 'Send 1507328 bytes',
    expected: 'confirmed value equals uploaded byte count',
  }, async () => {
    await B.req('file.accept', { id })
    const st = await A.req('file.start', { id })
    assert.equal(st.transfer.confirmed, 0)
    for (let off = 0; off < HALF; off += CH) A.chunk(id, off, data.subarray(off, Math.min(off + CH, HALF)))
    await A.waitFor((m) => m.t === 'file.progress' && m.confirmed === HALF)
    return `${HALF} bytes sent; server confirmed offset = ${HALF}`
  })
  await check({
    id: 'E2E-16', module: 'Resumable Transmission', goal: 'Confirmed offset persists after sender disconnects',
    pre: '1507328 bytes confirmed', steps: 'Close sender connection',
    expected: 'State becomes interrupted, offset preserved',
  }, async () => {
    await A.close()
    const intr = await B.waitFor((m) => m.t === 'file.state' && m.transfer.state === 'interrupted')
    assert.equal(intr.transfer.confirmed, HALF)
    return 'State changes to interrupted after sender disconnect; confirmed offset retained'
  })
  let A2
  await check({
    id: 'E2E-17', module: 'Resumable Transmission', goal: 'Transfer record remains available after reconnection',
    pre: 'Sender connection closed', steps: 'Reconnect using original token',
    expected: 'Confirmed offset 1507328 is returned in hello message',
  }, async () => {
    A2 = await new Peer(alice.token).open()
    const rec = A2.hello.transfers.find((t) => t.id === id)
    assert.equal(rec.state, 'interrupted')
    assert.equal(rec.confirmed, HALF)
    return 'Confirmed offset is preserved in transfer record after reconnection'
  })
  let resumeOffset
  await check({
    id: 'E2E-18', module: 'Resumable Transmission', goal: 'Data blocks with wrong offset are rejected',
    pre: 'Resume offset is 1507328', steps: 'Intentionally send block starting from incorrect offset',
    expected: 'Server replies with correct resume offset',
  }, async () => {
    const st = await A2.req('file.start', { id })
    resumeOffset = st.transfer.confirmed
    assert.equal(resumeOffset, HALF)
    A2.chunk(id, resumeOffset + CH, data.subarray(resumeOffset + CH, resumeOffset + 2 * CH))
    const resync = await A2.waitFor((m) => m.t === 'file.state' && m.transfer.state === 'sending')
    assert.equal(resync.transfer.confirmed, resumeOffset)
    return 'Misaligned block rejected; server responds with valid offset'
  })
  let sent = 0
  let finished
  await check({
    id: 'E2E-19', module: 'Resumable Transmission', goal: 'SHA-256 hash matches after resume completes',
    pre: 'Resume from confirmed offset', steps: 'Send remaining bytes and call finish',
    expected: 'state=done and hashOk=true',
  }, async () => {
    for (let off = resumeOffset; off < SIZE; off += CH) {
      const part = data.subarray(off, Math.min(off + CH, SIZE))
      A2.chunk(id, off, part)
      sent += part.length
    }
    await A2.waitFor((m) => m.t === 'file.progress' && m.confirmed === SIZE)
    finished = await A2.req('file.finish', { id })
    assert.equal(finished.transfer.state, 'done')
    assert.equal(finished.transfer.hashOk, true)
    return 'Transfer finished after resume; server-side SHA-256 matches original file'
  })
  await check({
    id: 'E2E-20', module: 'Resumable Transmission', goal: 'Sum of bytes from two sessions equals total file size',
    pre: 'Two separate transmission sessions exist', steps: 'Check starting offset and bytes sent in second session',
    expected: '1507328 + 1650745 = 3158073',
  }, async () => {
    const transfer = finished.transfer
    const last = transfer.sessions.at(-1)
    assert.equal(transfer.sessions.length, 2)
    assert.equal(last.startOffset, HALF)
    assert.equal(last.bytes, SIZE - HALF)
    assert.equal(last.startOffset + last.bytes, SIZE)
    assert.equal(sent, SIZE - HALF)
    return `A(${last.startOffset}) + B(${last.bytes}) = ${SIZE}; B is far smaller than full file size`
  })
  await check({
    id: 'E2E-21', module: 'File Transfer', goal: 'Downloaded content on receiver side is identical to original file',
    pre: 'Transfer completed', steps: 'GET /api/files/:id',
    expected: '200 response and SHA-256 matches original',
  }, async () => {
    const dl = await fetch(`${base}/api/files/${id}`, { headers: { Authorization: `Bearer ${bob.token}` } })
    const body = Buffer.from(await dl.arrayBuffer())
    assert.equal(dl.status, 200)
    assert.equal(sha(body), digest)
    return 'Bytes downloaded by receiver exactly match original file'
  })
  await check({
    id: 'E2E-22', module: 'File Transfer', goal: 'Unrelated users cannot download the file',
    pre: 'Carol is not the sender or receiver', steps: 'Carol tries to download the file',
    expected: '404 response',
  }, async () => {
    const dl = await fetch(`${base}/api/files/${id}`, { headers: { Authorization: `Bearer ${carol.token}` } })
    assert.equal(dl.status, 404)
    return 'Unauthorized third user download blocked'
  })
  await check({
    id: 'E2E-23', module: 'File Transfer', goal: 'Transfer rejected if final hash mismatches declared fingerprint',
    pre: 'An incorrect SHA-256 fingerprint was declared', steps: 'Complete transfer and call finish',
    expected: 'state=failed, hashOk=false',
  }, async () => {
    const fake = crypto.randomBytes(200000)
    const wrongDigest = sha(Buffer.from('not the same'))
    const o = await A2.req('file.offer', { to: bob.user.id, name: 'bad.bin', size: fake.length, sha256: wrongDigest })
    await B.req('file.accept', { id: o.transfer.id })
    await A2.req('file.start', { id: o.transfer.id })
    for (let off = 0; off < fake.length; off += CH) A2.chunk(o.transfer.id, off, fake.subarray(off, Math.min(off + CH, fake.length)))
    await A2.waitFor((m) => m.t === 'file.progress' && m.id === o.transfer.id && m.confirmed === fake.length)
    const bad = await A2.req('file.finish', { id: o.transfer.id })
    assert.equal(bad.transfer.state, 'failed')
    assert.equal(bad.transfer.hashOk, false)
    return 'Content SHA-256 inconsistent with declared hash; state set to failed'
  })
  await check({
    id: 'E2E-24', module: 'File Transfer', goal: 'Files failing hash check are not stored in received directory',
    pre: 'Previous transfer failed hash validation', steps: 'Inspect received folder',
    expected: 'bad.bin does not exist',
  }, async () => {
    assert.ok(!fs.readdirSync(path.join(tmp, 'received')).some((f) => f.includes('bad.bin')))
    return 'Failed file is not saved into received directory'
  })
  await check({
    id: 'E2E-25', module: 'Resumable Transmission', goal: 'Size of partial temporary file on disk matches ledger confirmed offset',
    pre: 'Partial bytes written and connection closed', steps: 'Compare partial file size and confirmed',
    expected: 'Values are equal',
  }, async () => {
    const big = crypto.randomBytes(500000)
    const o = await A2.req('file.offer', { to: bob.user.id, name: 'persist.bin', size: big.length, sha256: sha(big) })
    await B.req('file.accept', { id: o.transfer.id })
    await A2.req('file.start', { id: o.transfer.id })
    for (let off = 0; off < 200000; off += CH) A2.chunk(o.transfer.id, off, big.subarray(off, Math.min(off + CH, 200000)))
    await A2.waitFor((m) => m.t === 'file.progress' && m.id === o.transfer.id && m.confirmed >= 200000)
    const confirmedBefore = A2.events.filter((m) => m.t === 'file.progress' && m.id === o.transfer.id).at(-1).confirmed
    await A2.close()
    await sleep(300)
    const dbNow = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'))
    assert.equal(dbNow.transfers[o.transfer.id].confirmed, confirmedBefore)
    assert.equal(fs.statSync(path.join(tmp, 'partial', `${o.transfer.id}.part`)).size, confirmedBefore)
    return 'Size of partial file on disk matches confirmed offset stored in ledger'
  })
} catch (error) {
  console.error('\nFailed:', error)
  process.exitCode = 1
} finally {
  const passed = cases.filter((c) => c.pass).length
  const failed = cases.length - passed
  fs.writeFileSync(path.join(outDir, 'file-transfer-results.json'), JSON.stringify({
    owner: 'Ruoxi Zhou',
    scope: 'File Transfer and Resumable Transmission',
    summary: { total: cases.length, passed, failed, generatedAt: new Date().toISOString() },
    cases,
  }, null, 2))
  console.log(`\nFile Transfer Test ${passed}/${cases.length} passed`)
  server.close()
  await new Promise((r) => setTimeout(r, 250))
  fs.rmSync(tmp, { recursive: true, force: true })
  setTimeout(() => process.exit(process.exitCode || (failed ? 1 : 0)), 100)
}
