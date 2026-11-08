// 后端集成测试：真起服务、真连 WebSocket、真传文件。运行：npm test
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reliatox-'))
process.env.RELIATOX_DATA = tmp
const { start } = await import('../index.js')
const WebSocket = (await import('ws')).default

const { server, port } = await start({ port: 0, host: '127.0.0.1' })
const base = `http://127.0.0.1:${port}`
const post = async (url, body) => {
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

let passed = 0
const ok = (name) => console.log(`  ✓ ${name}`) || passed++

class Peer {
  constructor(token) {
    this.token = token
    this.events = []
    this.waiters = []
    this.rid = 1
    this.pending = new Map()
  }
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
  waitFor(test, ms = 5000) {
    const hit = this.events.find(test)
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('等待事件超时')), ms)
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
    return new Promise((r) => {
      this.ws.once('close', r)
      this.ws.close()
    })
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

try {
  console.log('账号')
  let r = await post('/api/register', { username: 'alice', password: '123456' })
  assert.equal(r.status, 200)
  const alice = r.body
  ok('注册成功，拿到 token 和 76 位 ID')
  assert.match(alice.user.toxId, /^[0-9A-F]{76}$/)
  r = await post('/api/register', { username: 'Alice', password: 'abcdef' })
  assert.equal(r.status, 400)
  ok('重名（不分大小写）被拒绝')
  r = await post('/api/register', { username: 'bob', password: '123' })
  assert.equal(r.status, 400)
  ok('弱密码被拒绝')
  r = await post('/api/register', { username: 'bob', password: 'bobpass' })
  const bob = r.body
  r = await post('/api/login', { username: 'alice', password: 'wrong!' })
  assert.equal(r.status, 401)
  ok('错误密码登录失败')
  r = await post('/api/login', { username: 'ALICE', password: '123456' })
  assert.equal(r.status, 200)
  ok('正确密码登录成功')
  const dbText = fs.readFileSync(path.join(tmp, 'db.json'), 'utf8')
  await sleep(200)
  assert.ok(!fs.readFileSync(path.join(tmp, 'db.json'), 'utf8').includes('123456'))
  ok('数据库里没有明文密码')
  void dbText

  const badWs = new WebSocket(`ws://127.0.0.1:${port}/ws?token=nope`)
  await new Promise((res) => badWs.on('error', res).on('close', res))
  ok('无效 token 连不上 WebSocket')

  console.log('好友与聊天')
  const A = await new Peer(alice.token).open()
  const B = await new Peer(bob.token).open()
  await assert.rejects(A.req('msg.send', { to: bob.user.id, text: 'hi' }), /好友/)
  ok('不是好友不能发消息')
  await A.req('friend.add', { query: bob.user.toxId })
  ok('用对方 ID 加好友')
  const fr = await B.waitFor((m) => m.t === 'friends' && m.friends.length === 1)
  assert.equal(fr.friends[0].username, 'alice')
  ok('对方实时收到好友列表更新')
  await A.req('msg.send', { to: bob.user.id, text: '你好 bob' })
  const got = await B.waitFor((m) => m.t === 'msg' && m.msg.text === '你好 bob')
  assert.equal(got.msg.from, alice.user.id)
  ok('消息实时送达')
  const hist = await B.req('history', { with: alice.user.id })
  assert.equal(hist.messages.length, 1)
  ok('历史记录可取回')

  console.log('断点续传')
  const SIZE = 3 * 1024 * 1024 + 12345
  const data = crypto.randomBytes(SIZE)
  const digest = sha(data)
  let o = await A.req('file.offer', { to: bob.user.id, name: 'big.bin', size: SIZE, sha256: digest })
  const id = o.transfer.id
  assert.match(id, /^[0-9a-f]{64}$/)
  assert.equal(o.transfer.state, 'offered')
  ok('offer 生成 32 字节 file id，状态 offered')
  await assert.rejects(A.req('file.start', { id }), /状态/)
  ok('接收方没接受前不能发')
  await B.req('file.accept', { id })
  let st = await A.req('file.start', { id })
  assert.equal(st.transfer.confirmed, 0)
  const CH = 64 * 1024
  const HALF = 1024 * 1024 + 7 * CH // 故意不是整数 MB
  for (let off = 0; off < HALF; off += CH) A.chunk(id, off, data.subarray(off, Math.min(off + CH, HALF)))
  await A.waitFor((m) => m.t === 'file.progress' && m.confirmed === HALF)
  ok(`发了 ${HALF} 字节，服务端确认 ${HALF}`)

  await A.close() // 真的断开发送方连接
  const intr = await B.waitFor((m) => m.t === 'file.state' && m.transfer.state === 'interrupted')
  assert.equal(intr.transfer.confirmed, HALF)
  ok('发送方断线后状态变为 interrupted，已确认偏移保留')

  const A2 = await new Peer(alice.token).open()
  const rec = A2.hello.transfers.find((t) => t.id === id)
  assert.equal(rec.state, 'interrupted')
  assert.equal(rec.confirmed, HALF)
  ok('重新连接后账本里还记着已确认偏移')

  st = await A2.req('file.start', { id })
  const A_OFFSET = st.transfer.confirmed
  assert.equal(A_OFFSET, HALF)
  let sent = 0
  // 先故意发一个错位的块：服务端必须拒收并让发送方重新对齐
  A2.chunk(id, A_OFFSET + CH, data.subarray(A_OFFSET + CH, A_OFFSET + 2 * CH))
  const resync = await A2.waitFor((m) => m.t === 'file.state' && m.transfer.state === 'sending')
  assert.equal(resync.transfer.confirmed, A_OFFSET)
  ok('错位的块被拒绝，服务端回报正确偏移')
  for (let off = A_OFFSET; off < SIZE; off += CH) {
    const part = data.subarray(off, Math.min(off + CH, SIZE))
    A2.chunk(id, off, part)
    sent += part.length
  }
  await A2.waitFor((m) => m.t === 'file.progress' && m.confirmed === SIZE)
  const fin = await A2.req('file.finish', { id })
  assert.equal(fin.transfer.state, 'done')
  assert.equal(fin.transfer.hashOk, true)
  ok('续传完成，服务端 SHA-256 与原文件一致')

  const last = fin.transfer.sessions.at(-1)
  assert.equal(fin.transfer.sessions.length, 2)
  assert.equal(last.startOffset, HALF)
  assert.equal(last.bytes, SIZE - HALF)
  assert.equal(last.startOffset + last.bytes, SIZE)
  assert.equal(sent, SIZE - HALF)
  assert.ok(last.bytes < SIZE / 2 + CH * 8)
  ok(`A(${last.startOffset}) + B(${last.bytes}) = ${SIZE}，B 远小于整个文件`)

  const dl = await fetch(`${base}/api/files/${id}`, { headers: { Authorization: `Bearer ${bob.token}` } })
  const body = Buffer.from(await dl.arrayBuffer())
  assert.equal(dl.status, 200)
  assert.equal(sha(body), digest)
  ok('接收方从服务器下载到的文件，字节与原文件完全一致')
  const stranger = await post('/api/register', { username: 'carol', password: 'carolpw' })
  const dl2 = await fetch(`${base}/api/files/${id}`, { headers: { Authorization: `Bearer ${stranger.body.token}` } })
  assert.equal(dl2.status, 404)
  ok('无关用户不能下载')

  console.log('校验失败路径')
  const fake = crypto.randomBytes(200000)
  const wrongDigest = sha(Buffer.from('not the same'))
  o = await A2.req('file.offer', { to: bob.user.id, name: 'bad.bin', size: fake.length, sha256: wrongDigest })
  await B.req('file.accept', { id: o.transfer.id })
  await A2.req('file.start', { id: o.transfer.id })
  for (let off = 0; off < fake.length; off += CH) A2.chunk(o.transfer.id, off, fake.subarray(off, Math.min(off + CH, fake.length)))
  await A2.waitFor((m) => m.t === 'file.progress' && m.id === o.transfer.id && m.confirmed === fake.length)
  const bad = await A2.req('file.finish', { id: o.transfer.id })
  assert.equal(bad.transfer.state, 'failed')
  assert.equal(bad.transfer.hashOk, false)
  ok('内容与声明的 SHA-256 不一致 → failed，不会改成正式文件')
  assert.ok(!fs.readdirSync(path.join(tmp, 'received')).some((f) => f.includes('bad.bin')))
  ok('failed 的文件没有出现在 received 目录')

  console.log('服务重启后账本仍在')
  const big = crypto.randomBytes(500000)
  o = await A2.req('file.offer', { to: bob.user.id, name: 'persist.bin', size: big.length, sha256: sha(big) })
  await B.req('file.accept', { id: o.transfer.id })
  await A2.req('file.start', { id: o.transfer.id })
  for (let off = 0; off < 200000; off += CH) A2.chunk(o.transfer.id, off, big.subarray(off, Math.min(off + CH, 200000)))
  await A2.waitFor((m) => m.t === 'file.progress' && m.id === o.transfer.id && m.confirmed >= 200000)
  const confirmedBefore = (await A2.events.filter((m) => m.t === 'file.progress' && m.id === o.transfer.id).at(-1)).confirmed
  await A2.close()
  await sleep(300)
  const dbNow = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'))
  assert.equal(dbNow.transfers[o.transfer.id].confirmed, confirmedBefore)
  assert.equal(fs.statSync(path.join(tmp, 'partial', o.transfer.id + '.part')).size, confirmedBefore)
  ok('磁盘上的临时文件大小 = 账本里的已确认偏移')

  console.log('会议')
  const A3 = await new Peer(alice.token).open()
  const c = await A3.req('meet.create', { title: '测试会' })
  assert.match(c.room.id, /^[A-Z2-9]{6}$/)
  ok(`新建会议，得到会议号 ${c.room.id}`)
  await assert.rejects(B.req('meet.join', { room: 'ZZZZZZ' }), /不存在/)
  ok('不存在的会议号被拒绝')
  const inv = await A3.req('meet.invite', { room: c.room.id, to: bob.user.id })
  assert.equal(inv.delivered, true)
  const invMsg = await B.waitFor((m) => m.t === 'meet.invite')
  assert.equal(invMsg.room.id, c.room.id)
  ok('邀请实时送达好友')
  const j = await B.req('meet.join', { room: c.room.id })
  assert.equal(j.peers.length, 1)
  assert.equal(j.peers[0].name, 'alice')
  const pj = await A3.waitFor((m) => m.t === 'meet.peer-joined')
  assert.equal(pj.peer.name, 'bob')
  ok('好友加入，双方互相知道对方')
  B.ws.send(JSON.stringify({ t: 'meet.signal', room: c.room.id, to: pj.peer.peerId === j.peerId ? c.peerId : c.peerId, data: { description: { type: 'offer', sdp: 'x' } } }))
  const sig = await A3.waitFor((m) => m.t === 'meet.signal')
  assert.equal(sig.from, j.peerId)
  assert.equal(sig.data.description.type, 'offer')
  ok('WebRTC 信令在两人之间转发')
  const carolWs = await new Peer(stranger.body.token).open()
  const j3 = await carolWs.req('meet.join', { room: c.room.id })
  assert.equal(j3.peers.length, 2)
  ok('陌生人拿会议号也能进，现在 3 人')
  B.ws.send(JSON.stringify({ t: 'meet.state', room: c.room.id, state: { audio: false, video: true, sharing: false } }))
  const ps = await A3.waitFor((m) => m.t === 'meet.peer-state')
  assert.equal(ps.state.audio, false)
  ok('静音状态广播给其他人')
  await B.close()
  const left = await A3.waitFor((m) => m.t === 'meet.peer-left')
  assert.equal(left.peerId, j.peerId)
  ok('有人断线，其他人收到离开通知')

  await A3.close()
  await carolWs.close()
  console.log(`\n全部通过：${passed} 项`)
} catch (e) {
  console.error('\n失败：', e)
  process.exitCode = 1
} finally {
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  setTimeout(() => process.exit(process.exitCode || 0), 100)
}
