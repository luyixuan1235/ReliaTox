// 吴嘉伟负责的功能测试：账号、好友与聊天、会议、页面、本地调度。
// 不含文件传输（FN-FILE-01～07 由周若曦的 file-transfer.mjs 覆盖）。
// 在项目根目录执行：node server/test/functional.mjs
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
  console.log('账号与鉴权')
  await check({
    id: 'FN-ACC-01', module: '账号', goal: '合法用户名与 6 位密码可以注册',
    pre: '临时空库', steps: 'POST /api/register username=ab password=123456',
    expected: '200，返回 token 与 76 位校验通过的 ID',
  }, async () => {
    const r = await post('/api/register', { username: 'ab', password: '123456' })
    assert.equal(r.status, 200)
    toxOk(r.body.user.toxId)
    return `200，ID 校验通过 ${r.body.user.toxId.slice(0, 8)}…`
  })
  await check({
    id: 'FN-ACC-02', module: '账号', goal: '用户名长度与字符等价类',
    pre: '服务已启动', steps: '分别注册 1 位、21 位、空格、符号、20 位、中文、下划线与连字符',
    expected: '非法输入 400；20 位、中文、下划线、连字符 200',
  }, async () => {
    const bad = ['a', 'a'.repeat(21), 'a b', 'ab!', '']
    for (const username of bad) {
      const r = await post('/api/register', { username, password: '123456' })
      assert.equal(r.status, 400, `应拒绝 ${JSON.stringify(username)}`)
    }
    for (const username of ['u'.repeat(20), '测试', 'ab_cd', 'ab-cd']) {
      const r = await post('/api/register', { username, password: '123456' })
      assert.equal(r.status, 200, `应接受 ${username}`)
    }
    return '5 个非法用户名均为 400，4 个合法用户名均为 200'
  })
  await check({
    id: 'FN-ACC-03', module: '账号', goal: '密码长度边界',
    pre: '用户名未占用', steps: '密码 5 位与 6 位各注册一次',
    expected: '5 位 400，6 位 200',
  }, async () => {
    const short = await post('/api/register', { username: 'pw5', password: '12345' })
    const ok = await post('/api/register', { username: 'pw6', password: '123456' })
    assert.equal(short.status, 400)
    assert.equal(ok.status, 200)
    return '5 位返回 400，6 位返回 200'
  })
  await check({
    id: 'FN-ACC-04', module: '账号', goal: '登录、会话与退出',
    pre: '已有用户 ab', steps: '错误密码、错误用户、正确登录、GET /api/me、POST /api/logout、再用旧 token',
    expected: '错误为 401；正确为 200；退出后旧 token 失效',
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
    return '错误登录 401，正确登录与 /api/me 200，退出后旧 token 401'
  })
  await check({
    id: 'FN-ACC-05', module: '账号', goal: '库中不保存明文密码',
    pre: '已注册用户', steps: '读取临时 db.json',
    expected: '文件不含 123456，含 salt 与 hash',
  }, async () => {
    await new Promise((r) => setTimeout(r, 250))
    const text = fs.readFileSync(path.join(tmp, 'db.json'), 'utf8')
    assert.equal(text.includes('123456'), false)
    assert.match(text, /"salt":/)
    assert.match(text, /"hash":/)
    return 'db.json 无明文密码，存在 salt 与 hash'
  })
  await check({
    id: 'FN-ACC-06', module: '账号', goal: '非法 JSON 与未知接口',
    pre: '服务已启动', steps: 'POST 非 JSON；GET /api/nope',
    expected: '分别返回 400 与 404',
  }, async () => {
    const r = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    const missing = await get('/api/nope')
    assert.equal(r.status, 400)
    assert.equal(missing.status, 404)
    return '非法 JSON 为 400，未知接口为 404'
  })

  const alice = (await post('/api/register', { username: 'alice', password: 'alicepw' })).body
  const bob = (await post('/api/register', { username: 'bob', password: 'bobpass' })).body
  const carol = (await post('/api/register', { username: 'carol', password: 'carolpw' })).body
  const A = await new Peer(alice.token).open()
  const B = await new Peer(bob.token).open()

  console.log('好友、聊天、离线消息')
  await check({
    id: 'FN-CHAT-01', module: '好友与聊天', goal: '用用户名加好友，重复添加不重复建关系',
    pre: 'alice、bob 在线且还不是好友', steps: 'friend.add query=BoB，再添加一次',
    expected: '第一次 already=false，第二次 already=true，bob 收到好友列表',
  }, async () => {
    const first = await A.req('friend.add', { query: 'BoB' })
    const seen = await B.waitFor((m) => m.t === 'friends' && m.friends.some((f) => f.username === 'alice'))
    const second = await A.req('friend.add', { query: 'bob' })
    assert.equal(first.already, false)
    assert.equal(second.already, true)
    assert.equal(seen.friends.length, 1)
    return '用户名不区分大小写，重复添加返回 already=true'
  })
  await check({
    id: 'FN-CHAT-02', module: '好友与聊天', goal: '76 位 ID 与 64 位前缀可以找到用户',
    pre: 'carol 已注册，尚未与 alice 成为好友', steps: '用完整 ID 添加，再单独解析 64 位前缀',
    expected: '添加成功；64 位前缀指向同一 toxId',
  }, async () => {
    const added = await A.req('friend.add', { query: carol.user.toxId })
    assert.equal(added.friend.username, 'carol')
    const prefix = carol.user.toxId.slice(0, 64)
    const again = await B.req('friend.add', { query: prefix })
    assert.equal(again.friend.toxId, carol.user.toxId)
    return '完整 ID 与 64 位前缀都定位到 carol'
  })
  await check({
    id: 'FN-CHAT-03', module: '好友与聊天', goal: '不存在的用户和自己都不能添加',
    pre: 'alice 在线', steps: 'friend.add ghost 与自己的用户名',
    expected: '两次都失败',
  }, async () => {
    await assert.rejects(A.req('friend.add', { query: 'ghost' }), /not found/i)
    await assert.rejects(A.req('friend.add', { query: 'alice' }), /yourself/i)
    return '不存在返回 User not found，添加自己被拒绝'
  })
  await check({
    id: 'FN-CHAT-04', module: '好友与聊天', goal: '空消息被拒绝，超长消息截断到 4000',
    pre: 'alice 与 bob 已是好友', steps: '发送空串，再发送 4001 个 a',
    expected: '空串失败；保存的文本长度为 4000',
  }, async () => {
    await assert.rejects(A.req('msg.send', { to: bob.user.id, text: '   ' }), /empty/i)
    const sent = await A.req('msg.send', { to: bob.user.id, text: 'a'.repeat(4001) })
    assert.equal(sent.msg.text.length, 4000)
    const got = await B.waitFor((m) => m.t === 'msg' && m.msg.text.length === 4000)
    assert.equal(got.msg.text, 'a'.repeat(4000))
    return '空消息被拒绝，4001 字符保存为 4000'
  })
  await check({
    id: 'FN-CHAT-05', module: '好友与聊天', goal: '对方离线时消息仍可在重连后取回',
    pre: '双方是好友', steps: '关闭 bob，alice 发送，bob 用原 token 重连并取 history',
    expected: '离线期间 bob 收不到实时事件；重连后历史中有该消息',
  }, async () => {
    await B.close()
    await A.req('msg.send', { to: bob.user.id, text: 'offline-note' })
    const B2 = await new Peer(bob.token).open()
    const live = B2.events.find((m) => m.t === 'msg' && m.msg.text === 'offline-note')
    const hist = await B2.req('history', { with: alice.user.id })
    assert.equal(live, undefined)
    assert.ok(hist.messages.some((m) => m.text === 'offline-note'))
    Object.assign(B, B2)
    return '离线消息未实时推送，history 可以取回'
  })
  await check({
    id: 'FN-CHAT-06', module: '好友与聊天', goal: '非好友不能读取历史',
    pre: 'alice 与一个未加好友的新用户', steps: '新用户请求与 alice 的 history',
    expected: '请求失败',
  }, async () => {
    const dave = (await post('/api/register', { username: 'dave', password: 'davepw' })).body
    const D = await new Peer(dave.token).open()
    await assert.rejects(D.req('history', { with: alice.user.id }), /friend/i)
    await D.close()
    return '非好友读取历史被拒绝'
  })

  console.log('会议信令')
  await check({
    id: 'FN-MEET-01', module: '会议', goal: '会议号字符集、主动离开与离线邀请',
    pre: 'alice 在会议中，bob 先在线后断开', steps: '创建会议、邀请在线 bob、bob 离开、再邀请离线 bob',
    expected: '会议号来自无歧义字符表；离开有通知；离线邀请 delivered=false',
  }, async () => {
    const created = await A.req('meet.create', { title: '功能测试' })
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
    return `会议号 ${created.room.id}；在线邀请送达，离开有通知，离线邀请 delivered=false`
  })
  await check({
    id: 'FN-MEET-02', module: '会议', goal: '第 9 个人不能加入',
    pre: '可再注册 7 个用户', steps: '连创建者共 8 人加入，第 9 人加入',
    expected: '前 8 人成功，第 9 人收到满员错误',
  }, async () => {
    const host = await post('/api/register', { username: 'host', password: 'hostpw' })
    const H = await new Peer(host.body.token).open()
    const room = await H.req('meet.create', { title: '容量' })
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
    return '8 人可以进入，第 9 人被拒绝'
  })
  await check({
    id: 'FN-MEET-03', module: '会议', goal: 'hello 带上 ICE 配置，ping 返回 pong',
    pre: '服务以 ICE_SERVERS 启动', steps: '查看 hello，发送 ping',
    expected: 'iceServers 与环境变量一致，并收到 pong',
  }, async () => {
    assert.equal(A.hello.iceServers[0].urls, 'stun:stun.example.com:19302')
    A.ws.send(JSON.stringify({ t: 'ping', n: 7 }))
    const pong = await A.waitFor((m) => m.t === 'pong' && m.n === 7)
    assert.equal(pong.n, 7)
    return 'hello.iceServers 正确，pong.n=7'
  })

  console.log('静态页面与本地调度规则')
  await check({
    id: 'FN-WEB-01', module: '页面', goal: '已构建页面可以打开，目录穿越不会读到项目外文件',
    pre: 'dist/index.html 存在', steps: 'GET / 与编码后的穿越路径',
    expected: '首页 200 且含 ReliaTox；穿越请求不会返回 package.json 正文',
  }, async () => {
    const home = await get('/')
    const sneak = await get('/..%2fpackage.json')
    assert.equal(home.status, 200)
    assert.match(String(home.body), /ReliaTox/)
    assert.equal(String(sneak.body).includes('"reliatox-web"'), false)
    return '首页 200，穿越路径未读出 package.json'
  })

  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { concurrencyLimit, buildLocalPlan } = await import('../../src/net/transfers.js')
  const { setState } = await import('../../src/net/store.js')
  const { formatBytes, exactBytes, shortHash } = await import('../../src/lib/format.js')

  await check({
    id: 'FN-SCH-01', module: '本地调度', goal: '三种策略与差链路的并发上限',
    pre: '不调用 DeepSeek', steps: '对 speed/fair/save、差链路和自适应并发计算上限',
    expected: 'speed=4，fair=3，save=1；差链路 speed 降为 2；自适应值不超过策略上限',
  }, async () => {
    assert.equal(concurrencyLimit({ policy: 'speed', quality: '好', adaptiveConcurrency: null }), 4)
    assert.equal(concurrencyLimit({ policy: 'fair', quality: '好', adaptiveConcurrency: null }), 3)
    assert.equal(concurrencyLimit({ policy: 'save', quality: '好', adaptiveConcurrency: null }), 1)
    assert.equal(concurrencyLimit({ policy: 'speed', quality: '差', adaptiveConcurrency: null }), 2)
    assert.equal(concurrencyLimit({ policy: 'speed', quality: '好', adaptiveConcurrency: 9 }), 4)
    assert.equal(concurrencyLimit({ policy: 'fair', quality: '差', adaptiveConcurrency: 3 }), 1)
    return '6 组并发上限与规则一致'
  })
  await check({
    id: 'FN-SCH-02', module: '本地调度', goal: '差链路且没有本地文件句柄时给出安全回退',
    pre: '不调用 DeepSeek', steps: '构造一条中断传输且页面没有原文件，链路质量为差',
    expected: '不生成续传动作，提示重新选择文件，并建议省电策略',
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
    return '本地方案要求重选文件，并把策略降为省电'
  })
  await check({
    id: 'FN-SCH-03', module: '本地调度', goal: '没有任务时不提出调整',
    pre: '传输列表为空', steps: '调用 buildLocalPlan',
    expected: '动作为空，并说明当前不需要调整',
  }, async () => {
    setState({ me: { id: 'u1' }, quality: '好', policy: 'fair', transfers: {} })
    const plan = buildLocalPlan()
    assert.deepEqual(plan.actions, [])
    assert.match(plan.items[0], /No transfer adjustments/)
    return '空列表返回一条“无需调整”说明'
  })
  await check({
    id: 'FN-SCH-04', module: '显示格式', goal: '字节、精确数字和指纹缩写的边界',
    pre: '无', steps: '格式化 0、1023、1024、1MiB、1GiB 与 64 位指纹',
    expected: '单位切换正确，缩写保留首尾 8 位',
  }, async () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1023), '1023 B')
    assert.equal(formatBytes(1024), '1.0 KB')
    assert.equal(formatBytes(1024 ** 2), '1.00 MB')
    assert.equal(formatBytes(1024 ** 3), '1.00 GB')
    assert.equal(exactBytes(1507328), '1,507,328 B')
    assert.equal(shortHash('a'.repeat(64)), 'aaaaaaaa…aaaaaaaa')
    return '字节单位、千分位和指纹缩写符合预期'
  })

  const home = await get('/')
  assert.equal(home.status, 200)
} finally {
  const passed = cases.filter((c) => c.pass).length
  const failed = cases.length - passed
  const summary = { total: cases.length, passed, failed, generatedAt: new Date().toISOString(), dataDir: tmp }
  fs.writeFileSync(path.join(outDir, 'wu-functional-results.json'), JSON.stringify({ summary, cases }, null, 2))
  console.log(`\n功能测试 ${passed}/${cases.length} 通过`)
  server.close()
  await new Promise((r) => setTimeout(r, 250))
  fs.rmSync(tmp, { recursive: true, force: true })
  setTimeout(() => process.exit(failed ? 1 : 0), 100)
}

void hub
