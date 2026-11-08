// 与服务端的连接：登录、WebSocket、请求/响应、重连、RTT 测量、好友和聊天。
import { getState, setState, saveToken, toast, log } from './store.js'

let ws = null
let rid = 1
const pending = new Map()
const handlers = new Map() // type -> Set<fn>
const linkHooks = new Set()
let manual = false
let retry = 0
let retryTimer = null
let pingTimer = null
let lastPong = 0
const rttSamples = []
const historyLoaded = new Set()

export function onEvent(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type).add(fn)
}
export const onLink = (fn) => linkHooks.add(fn)
const emit = (type, m) => handlers.get(type)?.forEach((fn) => fn(m))
const setLink = (link) => {
  if (getState().link === link) return
  setState({ link })
  linkHooks.forEach((fn) => fn(link))
}

// ---- HTTP：注册 / 登录 ---------------------------------------------------
async function http(path, body, token) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = {}
  try {
    data = await r.json()
  } catch {}
  if (!r.ok) throw new Error(data.error || `请求失败（${r.status}）`)
  return data
}
const afterAuth = ({ token, user }) => {
  saveToken(token)
  setState({ token, me: user, boot: false })
  connect()
}
export const register = async (username, password) => afterAuth(await http('/api/register', { username, password }))
export const login = async (username, password) => afterAuth(await http('/api/login', { username, password }))

export async function restore() {
  const token = getState().token
  if (!token) return setState({ boot: false })
  try {
    const { user } = await http('/api/me', null, token)
    setState({ me: user, boot: false })
    connect()
  } catch {
    saveToken(null)
    setState({ token: null, boot: false })
  }
}

export async function logout() {
  const { token } = getState()
  manual = true
  disconnect(true)
  try {
    await http('/api/logout', {}, token)
  } catch {}
  saveToken(null)
  historyLoaded.clear()
  setState({
    token: null, me: null, link: 'idle', friends: [], activeId: null, messages: {}, unread: {},
    transfers: {}, rates: {}, paused: {}, priority: [], events: [], meet: null, invite: null, tab: 'chat',
  })
}

// ---- WebSocket -----------------------------------------------------------
export function connect() {
  const { token } = getState()
  if (!token || (ws && ws.readyState <= 1)) return
  manual = false
  clearTimeout(retryTimer)
  setLink('connecting')
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const sock = new WebSocket(`${proto}://${location.host}/ws?token=${token}`)
  sock.binaryType = 'arraybuffer'
  ws = sock
  sock.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    let m
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    route(m)
  }
  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    stopPing()
    for (const p of pending.values()) p.reject(new Error('连接已断开'))
    pending.clear()
    setState({ rtt: null, quality: '—' })
    if (manual) return setLink('manual')
    setLink('offline')
    const wait = Math.min(1000 * 2 ** retry++, 8000)
    retryTimer = setTimeout(connect, wait)
  }
  sock.onerror = () => {}
}

function disconnect(silent) {
  clearTimeout(retryTimer)
  const sock = ws
  if (sock) {
    ws = null
    stopPing()
    try {
      sock.close()
    } catch {}
    for (const p of pending.values()) p.reject(new Error('连接已断开'))
    pending.clear()
  }
  setState({ rtt: null, quality: '—' })
  if (!silent) setLink('manual')
}

// 主动断网 / 恢复：真的关掉 WebSocket，不是改个标签
export function goOffline() {
  manual = true
  disconnect(false)
  log('link', '手动断开网络')
}
export function goOnline() {
  retry = 0
  connect()
  log('link', '手动恢复连接')
}

export const isOpen = () => !!ws && ws.readyState === 1
export function request(t, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!isOpen()) return reject(new Error('当前没有连接'))
    const id = rid++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ t, rid: id, ...payload }))
  })
}
export function send(t, payload = {}) {
  if (isOpen()) ws.send(JSON.stringify({ t, ...payload }))
}
export const bufferedAmount = () => (ws ? ws.bufferedAmount : 0)
export function sendChunk(id, offset, bytes) {
  const header = new TextEncoder().encode(JSON.stringify({ t: 'file.chunk', id, offset }))
  const out = new Uint8Array(4 + header.length + bytes.length)
  new DataView(out.buffer).setUint32(0, header.length)
  out.set(header, 4)
  out.set(bytes, 4 + header.length)
  ws.send(out)
}

// ---- RTT -----------------------------------------------------------------
function startPing() {
  stopPing()
  lastPong = performance.now()
  pingTimer = setInterval(() => {
    if (!isOpen()) return
    send('ping', { n: performance.now() })
    if (performance.now() - lastPong > 7000) setState({ quality: '差' })
  }, 2000)
  send('ping', { n: performance.now() })
}
const stopPing = () => {
  clearInterval(pingTimer)
  pingTimer = null
  rttSamples.length = 0
}
function onPong(m) {
  const now = performance.now()
  lastPong = now
  rttSamples.push(now - m.n)
  if (rttSamples.length > 5) rttSamples.shift()
  const rtt = Math.round(rttSamples.reduce((a, b) => a + b, 0) / rttSamples.length)
  setState({ rtt, quality: rtt < 80 ? '好' : rtt < 200 ? '一般' : '差' })
}

// ---- 事件分发 -------------------------------------------------------------
function route(m) {
  switch (m.t) {
    case 'res': {
      const p = pending.get(m.rid)
      if (!p) return
      pending.delete(m.rid)
      return m.ok ? p.resolve(m.data) : p.reject(new Error(m.error))
    }
    case 'pong':
      return onPong(m)
    case 'hello': {
      retry = 0
      historyLoaded.clear()
      const transfers = Object.fromEntries(m.transfers.map((t) => [t.id, t]))
      setState({ me: m.you, friends: m.friends, transfers, iceServers: m.iceServers || [], link: 'online' })
      linkHooks.forEach((fn) => fn('online'))
      startPing()
      const { activeId } = getState()
      if (activeId) loadHistory(activeId)
      log('link', `已连接服务器，账本里有 ${m.transfers.length} 个传输`)
      return emit('hello', m)
    }
    case 'friends':
      return setState((s) => ({ friends: m.friends, activeId: s.activeId || m.friends[0]?.id || null }))
    case 'presence':
      return setState((s) => ({ friends: s.friends.map((f) => (f.id === m.id ? { ...f, online: m.online } : f)) }))
    case 'msg':
      return onMessage(m.msg)
    default:
      emit(m.t, m)
  }
}

function onMessage(msg) {
  const s = getState()
  const other = msg.from === s.me.id ? msg.to : msg.from
  const list = s.messages[other] || []
  if (list.some((x) => x.id === msg.id)) return
  const looking = s.tab === 'chat' && s.activeId === other
  setState({
    messages: { ...s.messages, [other]: [...list, msg] },
    unread: msg.from !== s.me.id && !looking ? { ...s.unread, [other]: (s.unread[other] || 0) + 1 } : s.unread,
  })
  if (msg.from !== s.me.id && !looking) {
    const f = s.friends.find((x) => x.id === other)
    toast(f?.username || '新消息', msg.type === 'file' ? `发来文件 ${msg.text}` : msg.text)
  }
}

// ---- 好友 / 聊天 ----------------------------------------------------------
export async function loadHistory(friendId) {
  if (!friendId || historyLoaded.has(friendId) || !isOpen()) return
  historyLoaded.add(friendId)
  try {
    const { messages } = await request('history', { with: friendId })
    setState((s) => {
      const have = s.messages[friendId] || []
      const ids = new Set(messages.map((x) => x.id))
      const merged = [...messages, ...have.filter((x) => !ids.has(x.id))].sort((a, b) => a.at - b.at)
      return { messages: { ...s.messages, [friendId]: merged } }
    })
  } catch {
    historyLoaded.delete(friendId)
  }
}
export function openChat(friendId) {
  setState((s) => ({ activeId: friendId, tab: 'chat', unread: { ...s.unread, [friendId]: 0 } }))
  loadHistory(friendId)
}
export async function addFriend(query) {
  const { friend, already } = await request('friend.add', { query })
  toast(already ? '已经是好友' : '添加成功', friend.username)
  return friend
}
export async function sendText(to, text) {
  await request('msg.send', { to, text })
}
