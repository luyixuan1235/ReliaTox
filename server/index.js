// ReliaTox 服务端：HTTP（登录、下载、静态页面）+ WebSocket（聊天、传输、会议信令）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as S from './store.js'
import { createHub } from './hub.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(here, '..', 'dist')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
let iceServers = []
try {
  if (process.env.ICE_SERVERS) iceServers = JSON.parse(process.env.ICE_SERVERS)
} catch {
  console.error('ICE_SERVERS 不是合法 JSON，已忽略')
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 64 * 1024) {
        reject(new Error('请求太大'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('请求格式不对'))
      }
    })
    req.on('error', reject)
  })
const bearer = (req, url) => {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token')
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,20}$/

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`
  try {
    if (route === 'POST /api/register') {
      const { username, password } = await readBody(req)
      if (!USERNAME_RE.test(username || '')) return json(res, 400, { error: '用户名需要 2–20 个字符：中英文、数字、下划线、短横线' })
      if (typeof password !== 'string' || password.length < 6) return json(res, 400, { error: '密码至少 6 位' })
      const user = await S.createUser(username, password)
      return json(res, 200, { token: S.createSession(user.id), user: S.publicUser(user) })
    }
    if (route === 'POST /api/login') {
      const { username, password } = await readBody(req)
      const user = await S.verifyUser(String(username || ''), String(password || ''))
      if (!user) {
        await wait(400)
        return json(res, 401, { error: '用户名或密码不对' })
      }
      return json(res, 200, { token: S.createSession(user.id), user: S.publicUser(user) })
    }
    if (route === 'GET /api/me') {
      const user = S.userByToken(bearer(req, url))
      return user ? json(res, 200, { user: S.publicUser(user) }) : json(res, 401, { error: '未登录' })
    }
    if (route === 'POST /api/logout') {
      S.deleteSession(bearer(req, url))
      return json(res, 200, { ok: true })
    }
    const m = url.pathname.match(/^\/api\/files\/([0-9a-f]{64})$/)
    if (req.method === 'GET' && m) {
      const user = S.userByToken(bearer(req, url))
      const t = S.getTransfer(m[1])
      if (!user || !t || (t.from !== user.id && t.to !== user.id)) return json(res, 404, { error: '没有这个文件' })
      if (t.state !== 'done' || !t.finalPath || !fs.existsSync(t.finalPath)) return json(res, 409, { error: '文件还没有传完' })
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fs.statSync(t.finalPath).size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(t.name)}`,
      })
      return fs.createReadStream(t.finalPath).pipe(res)
    }
    return json(res, 404, { error: '没有这个接口' })
  } catch (e) {
    return json(res, 400, { error: e.message || '请求失败' })
  }
}

function serveStatic(req, res, url) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('前端还没有构建。先运行 npm run build，或者开发时用 npm run dev 打开 5173 端口。')
  }
  let rel = decodeURIComponent(url.pathname)
  let file = path.normalize(path.join(DIST, rel))
  if (!file.startsWith(DIST)) {
    res.writeHead(403)
    return res.end()
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

export function start({ port = PORT, host = HOST } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/api/')) return api(req, res, url)
    return serveStatic(req, res, url)
  })
  const hub = createHub(server, { iceServers })
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, hub, port: server.address().port }))
  })
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  start().then(({ port }) => {
    console.log(`ReliaTox 已启动：http://${HOST}:${port}/`)
    console.log(`数据目录：${S.DATA_DIR}`)
  })
  const bye = () => {
    S.flush()
    process.exit(0)
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}
