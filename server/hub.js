// WebSocket 中枢：在线状态、聊天、文件传输（断点续传账本）、会议信令。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import * as S from './store.js'

const conns = new Map() // connId -> conn
const byUser = new Map() // userId -> Set<conn>
const rooms = new Map() // code -> room
const active = new Map() // transferId -> connId（正在发送的连接）
const fds = new Map() // transferId -> fd
const progressTimers = new Map()

const MAX_FILE = 20 * 1024 ** 3
const PROGRESS_MS = 150

const send = (ws, obj) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj))
}
const toUser = (userId, obj) => byUser.get(userId)?.forEach((c) => send(c.ws, obj))
const isOnline = (userId) => (byUser.get(userId)?.size || 0) > 0

const friendView = (u) => ({ id: u.id, username: u.username, toxId: u.toxId, online: isOnline(u.id) })
const friendsOf = (userId) => S.friendIds(userId).map(S.getUser).filter(Boolean).map(friendView)
const pushFriends = (userId) => toUser(userId, { t: 'friends', friends: friendsOf(userId) })
const pushPresence = (userId, online) => {
  for (const fid of S.friendIds(userId)) toUser(fid, { t: 'presence', id: userId, online })
}

const pubT = (t) => ({
  id: t.id,
  from: t.from,
  to: t.to,
  name: t.name,
  size: t.size,
  sha256: t.sha256,
  confirmed: t.confirmed,
  state: t.state,
  sessions: t.sessions.map((s) => ({ startOffset: s.startOffset, bytes: s.bytes })),
  createdAt: t.createdAt,
  hashOk: t.hashOk ?? null,
  receivedSha256: t.receivedSha256 || null,
  reason: t.reason || null,
  updatedAt: t.updatedAt || t.createdAt,
})
const pushT = (t) => {
  const msg = { t: 'file.state', transfer: pubT(t) }
  toUser(t.from, msg)
  toUser(t.to, msg)
}
const partPath = (t) => path.join(S.PART_DIR, t.id + '.part')

function closeFd(id) {
  const fd = fds.get(id)
  if (fd != null) {
    try {
      fs.closeSync(fd)
    } catch {}
    fds.delete(id)
  }
}
function openFd(t) {
  let fd = fds.get(t.id)
  if (fd == null) {
    fd = fs.openSync(partPath(t), 'a+')
    fds.set(t.id, fd)
  }
  return fd
}
function dropPart(t) {
  closeFd(t.id)
  try {
    fs.unlinkSync(partPath(t))
  } catch {}
}
function setState(t, state, extra = {}) {
  Object.assign(t, extra, { state, updatedAt: Date.now() })
  S.putTransfer(t)
  pushT(t)
}
function emitProgress(t, force = false) {
  const push = () => {
    const s = t.sessions[t.sessions.length - 1]
    const msg = { t: 'file.progress', id: t.id, confirmed: t.confirmed, session: s && { startOffset: s.startOffset, bytes: s.bytes } }
    toUser(t.from, msg)
    toUser(t.to, msg)
  }
  if (force) {
    clearTimeout(progressTimers.get(t.id))
    progressTimers.delete(t.id)
    return push()
  }
  if (progressTimers.has(t.id)) return
  progressTimers.set(
    t.id,
    setTimeout(() => {
      progressTimers.delete(t.id)
      push()
    }, PROGRESS_MS),
  )
}

function hashFile(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(p)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}
const safeName = (name) =>
  [...path.basename(String(name || ''))]
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .slice(0, 180) || 'file'

// 服务重启：上次还在发送的任务一律标为“可恢复”，账本里的已确认偏移保留
function recoverInterrupted() {
  for (const t of S.allTransfers()) {
    if (t.state === 'sending' || t.state === 'verifying') {
      t.state = 'interrupted'
      t.updatedAt = Date.now()
      S.putTransfer(t)
    }
  }
}

// ---- 会议 -------------------------------------------------------------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function newRoomCode() {
  for (;;) {
    let c = ''
    for (let i = 0; i < 6; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)]
    if (!rooms.has(c)) return c
  }
}
const memberView = (m) => ({ peerId: m.conn.id, userId: m.conn.user.id, name: m.conn.user.username, state: m.state })
function roomBroadcast(room, obj, exceptConnId) {
  for (const [id, m] of room.members) if (id !== exceptConnId) send(m.conn.ws, obj)
}
function leaveRoom(conn) {
  const room = conn.roomId && rooms.get(conn.roomId)
  conn.roomId = null
  if (!room) return
  room.members.delete(conn.id)
  roomBroadcast(room, { t: 'meet.peer-left', room: room.id, peerId: conn.id })
  if (room.members.size === 0) rooms.delete(room.id)
}
function joinRoom(conn, room) {
  if (conn.roomId) leaveRoom(conn)
  const peers = [...room.members.values()].map(memberView)
  const me = { conn, state: { audio: true, video: true, sharing: false } }
  room.members.set(conn.id, me)
  conn.roomId = room.id
  roomBroadcast(room, { t: 'meet.peer-joined', room: room.id, peer: memberView(me) }, conn.id)
  return { room: { id: room.id, title: room.title }, peerId: conn.id, peers }
}

// ---- 请求处理 ---------------------------------------------------------
const handlers = {
  ping(conn, m) {
    send(conn.ws, { t: 'pong', n: m.n })
  },

  'friend.add'(conn, m) {
    const target = S.findUser(m.query)
    if (!target) throw new Error('没有找到这个用户')
    if (target.id === conn.user.id) throw new Error('不能添加自己')
    const had = S.areFriends(conn.user.id, target.id)
    S.addFriendship(conn.user.id, target.id)
    pushFriends(conn.user.id)
    pushFriends(target.id)
    return { friend: friendView(target), already: had }
  },

  'msg.send'(conn, m) {
    const text = String(m.text || '').trim().slice(0, 4000)
    if (!text) throw new Error('消息不能为空')
    if (!S.areFriends(conn.user.id, m.to)) throw new Error('对方还不是你的好友')
    const msg = S.addMessage({ from: conn.user.id, to: m.to, text })
    toUser(msg.from, { t: 'msg', msg })
    toUser(msg.to, { t: 'msg', msg })
    return { msg }
  },

  history(conn, m) {
    if (!S.areFriends(conn.user.id, m.with)) throw new Error('对方还不是你的好友')
    return { messages: S.history(conn.user.id, m.with) }
  },

  // ---- 文件：offer → accept → start → chunk… → finish ----
  'file.offer'(conn, m) {
    const to = S.getUser(m.to)
    if (!to || !S.areFriends(conn.user.id, to.id)) throw new Error('对方还不是你的好友')
    const name = safeName(m.name)
    const size = Number(m.size)
    if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE) throw new Error('文件大小不合法')
    if (!/^[0-9a-f]{64}$/.test(m.sha256 || '')) throw new Error('缺少文件指纹')
    // 同一发送方、接收方、文件名、大小、指纹 → 同一个 32 字节 file id。重新选同一个文件就能续上。
    const id = crypto.createHash('sha256').update(`${conn.user.id}|${to.id}|${name}|${size}|${m.sha256}`).digest('hex')
    let t = S.getTransfer(id)
    let created = false
    if (t && (t.state === 'canceled' || t.state === 'failed')) {
      dropPart(t)
      Object.assign(t, { confirmed: 0, sessions: [], hashOk: null, reason: null, createdAt: Date.now() })
      t.state = 'offered'
      created = true
    } else if (!t) {
      t = { id, from: conn.user.id, to: to.id, name, size, sha256: m.sha256, confirmed: 0, state: 'offered', sessions: [], createdAt: Date.now(), updatedAt: Date.now() }
      created = true
    }
    S.putTransfer(t)
    if (created) {
      const msg = S.addMessage({ from: t.from, to: t.to, type: 'file', text: name, transferId: id })
      toUser(t.from, { t: 'msg', msg })
      toUser(t.to, { t: 'msg', msg })
    }
    pushT(t)
    return { transfer: pubT(t), already: t.state === 'done' }
  },

  'file.accept'(conn, m) {
    const t = S.getTransfer(m.id)
    if (!t || t.to !== conn.user.id) throw new Error('没有这个传输')
    if (t.state !== 'offered') return { transfer: pubT(t) }
    fs.closeSync(fs.openSync(partPath(t), 'a'))
    setState(t, 'accepted')
    return { transfer: pubT(t) }
  },

  'file.cancel'(conn, m) {
    const t = S.getTransfer(m.id)
    if (!t || (t.from !== conn.user.id && t.to !== conn.user.id)) throw new Error('没有这个传输')
    if (t.state === 'done') throw new Error('已经传完，不能取消')
    active.delete(t.id)
    dropPart(t)
    setState(t, 'canceled')
    return { transfer: pubT(t) }
  },

  'file.start'(conn, m) {
    const t = S.getTransfer(m.id)
    if (!t || t.from !== conn.user.id) throw new Error('没有这个传输')
    if (!['accepted', 'interrupted', 'sending'].includes(t.state)) throw new Error('当前状态不能发送：' + t.state)
    const holder = active.get(t.id)
    if (holder && holder !== conn.id && conns.has(holder)) throw new Error('这个文件正在另一个窗口发送')
    closeFd(t.id)
    // 对账：磁盘上的实际字节数是准的。账本领先于磁盘就退回；磁盘领先于账本就截断。
    let disk = 0
    try {
      disk = fs.statSync(partPath(t)).size
    } catch {}
    if (disk > t.confirmed) fs.truncateSync(partPath(t), t.confirmed)
    else if (disk < t.confirmed) t.confirmed = disk
    t.sessions.push({ startOffset: t.confirmed, bytes: 0, startedAt: Date.now() })
    active.set(t.id, conn.id)
    setState(t, 'sending')
    return { transfer: pubT(t) }
  },

  async 'file.finish'(conn, m) {
    const t = S.getTransfer(m.id)
    if (!t || t.from !== conn.user.id) throw new Error('没有这个传输')
    if (t.state === 'done') return { transfer: pubT(t) }
    if (t.confirmed !== t.size) {
      pushT(t)
      throw new Error(`还没收齐：已确认 ${t.confirmed} / ${t.size}`)
    }
    active.delete(t.id)
    closeFd(t.id)
    setState(t, 'verifying')
    const digest = await hashFile(partPath(t))
    if (digest === t.sha256) {
      const final = path.join(S.DONE_DIR, `${t.id.slice(0, 8)}-${t.name}`)
      fs.renameSync(partPath(t), final)
      setState(t, 'done', { hashOk: true, finalPath: final, receivedSha256: digest })
    } else {
      dropPart(t)
      setState(t, 'failed', { hashOk: false, reason: 'SHA-256 不一致，已丢弃临时文件', receivedSha256: digest })
    }
    return { transfer: pubT(t) }
  },

  // ---- 会议 ----
  'meet.create'(conn, m) {
    const title = String(m.title || '').trim().slice(0, 60) || `${conn.user.username} 的会议`
    const room = { id: newRoomCode(), title, hostId: conn.user.id, members: new Map(), createdAt: Date.now() }
    rooms.set(room.id, room)
    return joinRoom(conn, room)
  },
  'meet.join'(conn, m) {
    const room = rooms.get(String(m.room || '').trim().toUpperCase())
    if (!room) throw new Error('会议号不存在，或会议已经结束')
    if (room.members.size >= 8) throw new Error('会议人数已满（最多 8 人）')
    return joinRoom(conn, room)
  },
  'meet.leave'(conn) {
    leaveRoom(conn)
  },
  'meet.signal'(conn, m) {
    const room = rooms.get(m.room)
    const target = room?.members.get(m.to)
    if (!room || !room.members.has(conn.id) || !target) return
    send(target.conn.ws, { t: 'meet.signal', room: room.id, from: conn.id, data: m.data })
  },
  'meet.state'(conn, m) {
    const room = rooms.get(m.room)
    const me = room?.members.get(conn.id)
    if (!me) return
    me.state = { audio: !!m.state?.audio, video: !!m.state?.video, sharing: !!m.state?.sharing }
    roomBroadcast(room, { t: 'meet.peer-state', room: room.id, peerId: conn.id, state: me.state }, conn.id)
  },
  'meet.invite'(conn, m) {
    const room = rooms.get(m.room)
    if (!room || !room.members.has(conn.id)) throw new Error('你不在这个会议里')
    if (!S.areFriends(conn.user.id, m.to)) throw new Error('对方还不是你的好友')
    const delivered = isOnline(m.to)
    toUser(m.to, { t: 'meet.invite', room: { id: room.id, title: room.title }, from: S.publicUser(conn.user) })
    return { delivered }
  },
}

function onBinary(conn, buf) {
  if (buf.length < 4) return
  const hlen = buf.readUInt32BE(0)
  if (hlen > buf.length - 4) return
  let header
  try {
    header = JSON.parse(buf.subarray(4, 4 + hlen).toString('utf8'))
  } catch {
    return
  }
  if (header.t !== 'file.chunk') return
  const payload = buf.subarray(4 + hlen)
  const t = S.getTransfer(header.id)
  if (!t || t.from !== conn.user.id || t.state !== 'sending' || active.get(t.id) !== conn.id) return
  if (header.offset !== t.confirmed) {
    // 双方进度不一致：告诉发送方应该从哪里续
    send(conn.ws, { t: 'file.state', transfer: pubT(t) })
    return
  }
  if (payload.length === 0 || t.confirmed + payload.length > t.size) return
  const fd = openFd(t)
  fs.writeSync(fd, payload, 0, payload.length, t.confirmed)
  t.confirmed += payload.length
  const s = t.sessions[t.sessions.length - 1]
  s.bytes += payload.length
  t.updatedAt = Date.now()
  S.save()
  emitProgress(t, t.confirmed === t.size)
}

function onClose(conn) {
  conns.delete(conn.id)
  const set = byUser.get(conn.user.id)
  set?.delete(conn)
  leaveRoom(conn)
  // 这条连接正在发的文件：关文件、标为可恢复，已确认偏移留在账本里
  for (const [tid, cid] of [...active]) {
    if (cid !== conn.id) continue
    active.delete(tid)
    const t = S.getTransfer(tid)
    if (t && t.state === 'sending') {
      closeFd(tid)
      setState(t, 'interrupted')
    }
  }
  if (set && set.size === 0) {
    byUser.delete(conn.user.id)
    pushPresence(conn.user.id, false)
  }
}

export function createHub(server, { iceServers = [] } = {}) {
  recoverInterrupted()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/ws') return socket.destroy()
    const user = S.userByToken(url.searchParams.get('token'))
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, user))
  })

  function onConnect(ws, user) {
    const conn = { id: crypto.randomBytes(6).toString('hex'), ws, user, roomId: null }
    conns.set(conn.id, conn)
    let set = byUser.get(user.id)
    const first = !set || set.size === 0
    if (!set) byUser.set(user.id, (set = new Set()))
    set.add(conn)

    send(ws, {
      t: 'hello',
      you: S.publicUser(user),
      connId: conn.id,
      friends: friendsOf(user.id),
      transfers: S.transfersOf(user.id).map(pubT),
      iceServers,
    })
    if (first) pushPresence(user.id, true)

    ws.on('message', async (data, isBinary) => {
      if (isBinary) return onBinary(conn, data)
      let m
      try {
        m = JSON.parse(data.toString())
      } catch {
        return
      }
      const fn = handlers[m.t]
      if (!fn) return
      try {
        const out = await fn(conn, m)
        if (m.rid != null) send(ws, { t: 'res', rid: m.rid, ok: true, data: out ?? {} })
      } catch (e) {
        if (m.rid != null) send(ws, { t: 'res', rid: m.rid, ok: false, error: e.message || String(e) })
        else console.error(m.t, e.message)
      }
    })
    ws.on('close', () => onClose(conn))
    ws.on('error', () => {})
  }

  return { wss, conns, rooms }
}

export function receivedFilePath(t) {
  return t.finalPath
}
