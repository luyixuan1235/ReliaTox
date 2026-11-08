// 持久化存储：用户、好友、消息、传输账本。全部落在 JSON 文件里，服务重启后不丢。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.RELIATOX_DATA || path.join(here, 'data')
export const PART_DIR = path.join(DATA_DIR, 'partial')
export const DONE_DIR = path.join(DATA_DIR, 'received')
const DB_FILE = path.join(DATA_DIR, 'db.json')

fs.mkdirSync(PART_DIR, { recursive: true })
fs.mkdirSync(DONE_DIR, { recursive: true })

const scrypt = promisify(crypto.scrypt)
const SESSION_TTL = 7 * 24 * 3600 * 1000

const empty = () => ({ users: {}, friends: {}, messages: [], transfers: {}, sessions: {} })
let db = empty()
if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }
  } catch (e) {
    console.error('db.json 损坏，已忽略：', e.message)
  }
}

let timer = null
export function save() {
  if (timer) return
  timer = setTimeout(flush, 120)
}
export function flush() {
  clearTimeout(timer)
  timer = null
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db))
  fs.renameSync(tmp, DB_FILE)
}

// ---- 用户 -------------------------------------------------------------
// ID 采用 Tox ID 的版式（32 字节公钥 + 4 字节 nospam + 2 字节校验 = 76 个十六进制字符）。
// 注意：这是演示服务端随机生成的，不是 toxcore 的密钥。
function makeToxId() {
  const body = Buffer.concat([crypto.randomBytes(32), crypto.randomBytes(4)])
  const cs = Buffer.alloc(2)
  for (let i = 0; i < body.length; i++) cs[i % 2] ^= body[i]
  return Buffer.concat([body, cs]).toString('hex').toUpperCase()
}

export const publicUser = (u) => ({ id: u.id, username: u.username, toxId: u.toxId })
export const getUser = (id) => db.users[id] || null

export async function createUser(username, password) {
  const key = username.toLowerCase()
  if (Object.values(db.users).some((u) => u.username.toLowerCase() === key)) {
    throw new Error('用户名已被占用')
  }
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, 64)
  const user = {
    id: crypto.randomUUID(),
    username,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    toxId: makeToxId(),
    createdAt: Date.now(),
  }
  db.users[user.id] = user
  save()
  return user
}

export async function verifyUser(username, password) {
  const key = username.toLowerCase()
  const user = Object.values(db.users).find((u) => u.username.toLowerCase() === key)
  // 用户不存在时也做一次 scrypt，避免通过耗时枚举用户名
  const salt = Buffer.from(user ? user.salt : '00'.repeat(16), 'hex')
  const hash = await scrypt(password, salt, 64)
  if (!user) return null
  const ok = crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))
  return ok ? user : null
}

export function findUser(query) {
  const q = String(query || '').trim()
  if (!q) return null
  const users = Object.values(db.users)
  if (/^[0-9a-fA-F]{76}$/.test(q)) return users.find((u) => u.toxId === q.toUpperCase()) || null
  if (/^[0-9a-fA-F]{64}$/.test(q)) return users.find((u) => u.toxId.startsWith(q.toUpperCase())) || null
  return users.find((u) => u.username.toLowerCase() === q.toLowerCase()) || null
}

// ---- 会话令牌 ---------------------------------------------------------
export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex')
  db.sessions[token] = { userId, exp: Date.now() + SESSION_TTL }
  save()
  return token
}
export function userByToken(token) {
  const s = token && db.sessions[token]
  if (!s) return null
  if (s.exp < Date.now()) {
    delete db.sessions[token]
    return null
  }
  return db.users[s.userId] || null
}
export function deleteSession(token) {
  delete db.sessions[token]
  save()
}

// ---- 好友 -------------------------------------------------------------
export const friendIds = (userId) => db.friends[userId] || []
export const areFriends = (a, b) => friendIds(a).includes(b)
export function addFriendship(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const list = (db.friends[x] ||= [])
    if (!list.includes(y)) list.push(y)
  }
  save()
}

// ---- 消息 -------------------------------------------------------------
export function addMessage({ from, to, type = 'text', text = '', transferId = null }) {
  const msg = { id: crypto.randomUUID(), from, to, type, text, transferId, at: Date.now() }
  db.messages.push(msg)
  if (db.messages.length > 5000) db.messages.splice(0, db.messages.length - 5000)
  save()
  return msg
}
export function history(a, b, limit = 200) {
  const out = []
  for (let i = db.messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = db.messages[i]
    if ((m.from === a && m.to === b) || (m.from === b && m.to === a)) out.push(m)
  }
  return out.reverse()
}

// ---- 传输账本 ---------------------------------------------------------
export const getTransfer = (id) => db.transfers[id] || null
export function putTransfer(t) {
  db.transfers[t.id] = t
  save()
  return t
}
export const transfersOf = (userId) =>
  Object.values(db.transfers).filter((t) => t.from === userId || t.to === userId)
export const allTransfers = () => Object.values(db.transfers)
