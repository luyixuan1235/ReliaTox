// 发送端：读文件、算 SHA-256、按调度策略分块发送、断线后从服务端已确认偏移续传。
import { sha256 } from 'js-sha256'
import { bufferedAmount, isOpen, onEvent, onLink, request, sendChunk } from './client.js'
import { getState, log, setState, toast } from './store.js'
import { formatBytes } from '../lib/format.js'

const files = new Map() // transferId -> File（只在本页内存里；刷新页面后需要重新选同一个文件）
const ctl = new Map() // transferId -> { next, busy, finishing }
const lastProgress = new Map() // transferId -> { at, bytes }
const TICK_MS = 40
const MAX_CHUNK = 64 * 1024
const MAX_BUFFER = 2 * 1024 * 1024
let bucket = 0
let lastTick = performance.now()

const BASE_LIMIT = { speed: 4, fair: 3, save: 1 }
export function concurrencyLimit(s = getState()) {
  const base = BASE_LIMIT[s.policy] || 3
  return s.quality === '差' ? Math.max(1, Math.floor(base / 2)) : base
}
export const hasFile = (id) => files.has(id)

const patchTransfer = (t) => setState((s) => ({ transfers: { ...s.transfers, [t.id]: { ...s.transfers[t.id], ...t } } }))

// ---- 选文件 → 算指纹 → offer ----------------------------------------------
async function fingerprint(file, key) {
  const h = sha256.create()
  const STEP = 4 * 1024 * 1024
  for (let off = 0; off < file.size; off += STEP) {
    h.update(new Uint8Array(await file.slice(off, off + STEP).arrayBuffer()))
    setState((s) => ({ hashing: { ...s.hashing, [key]: { name: file.name, pct: Math.min(100, Math.round(((off + STEP) / file.size) * 100)) } } }))
    await new Promise((r) => setTimeout(r)) // 让出主线程，界面不卡
  }
  return h.hex()
}
const clearHashing = (key) => setState((s) => ({ hashing: Object.fromEntries(Object.entries(s.hashing).filter(([k]) => k !== key)) }))

export async function sendFile(friendId, file) {
  if (!file.size) return toast('不能发送', '这是一个空文件')
  const key = `${friendId}:${file.name}:${file.size}:${Date.now()}`
  try {
    setState((s) => ({ hashing: { ...s.hashing, [key]: { name: file.name, pct: 0 } } }))
    const digest = await fingerprint(file, key)
    const { transfer, already } = await request('file.offer', { to: friendId, name: file.name, size: file.size, sha256: digest })
    files.set(transfer.id, file)
    patchTransfer(transfer)
    if (already) toast('这个文件已经传完过', file.name)
    else if (transfer.state === 'interrupted') promptResume(transfer.id)
    else if (transfer.state === 'accepted') await startTransfer(transfer.id)
    else toast('已发出文件请求', `等 ${friendName(friendId)} 点击“接收”后开始传`)
    log('file', `发出 ${file.name}（${formatBytes(file.size)}）`)
  } catch (e) {
    toast('发送失败', e.message)
  } finally {
    clearHashing(key)
  }
}
const friendName = (id) => getState().friends.find((f) => f.id === id)?.username || '对方'

// 页面刷新后文件对象丢了：重新选同一个文件，指纹相同 → file id 相同 → 账本里的进度原样接上
export async function reattach(transferId, file) {
  const t = getState().transfers[transferId]
  if (!t) return
  if (file.size !== t.size || file.name !== t.name) return toast('不是原来的文件', `需要 ${t.name}（${t.size} 字节）`)
  const key = `reattach:${transferId}`
  try {
    setState((s) => ({ hashing: { ...s.hashing, [key]: { name: file.name, pct: 0 } } }))
    const digest = await fingerprint(file, key)
    if (digest !== t.sha256) return toast('不是原来的文件', '内容指纹不一致，不能续传')
    files.set(transferId, file)
    if (t.state === 'accepted') await startTransfer(transferId)
    else promptResume(transferId)
  } finally {
    clearHashing(key)
  }
}

export const accept = (id) => request('file.accept', { id }).catch((e) => toast('接收失败', e.message))
export async function cancel(id) {
  try {
    await request('file.cancel', { id })
    ctl.delete(id)
    files.delete(id)
  } catch (e) {
    toast('取消失败', e.message)
  }
}

const starting = new Set()
function finishTransfer(id) {
  const c = ctl.get(id)
  if (!c || c.finishing) return
  c.finishing = true
  request('file.finish', { id })
    .then(({ transfer }) => patchTransfer(transfer))
    .catch((e) => toast('收尾失败', e.message))
    .finally(() => ctl.delete(id))
}

export async function startTransfer(id) {
  if (starting.has(id)) return
  starting.add(id)
  try {
    const { transfer } = await request('file.start', { id })
    ctl.set(id, { next: transfer.confirmed, busy: false, finishing: false })
    patchTransfer(transfer)
    if (transfer.confirmed === transfer.size) finishTransfer(id)
    setState((s) => ({ paused: { ...s.paused, [id]: false }, resumePrompt: s.resumePrompt === id ? null : s.resumePrompt }))
    const last = transfer.sessions.at(-1)
    log('file', `${transfer.name}：从偏移 ${last.startOffset} 开始发送${transfer.sessions.length > 1 ? '（续传）' : ''}`)
  } catch (e) {
    toast('开始传输失败', e.message)
  } finally {
    starting.delete(id)
  }
}

export const pause = (id) => setState((s) => ({ paused: { ...s.paused, [id]: true } }))
export const resume = (id) => setState((s) => ({ paused: { ...s.paused, [id]: false } }))

function promptResume(id) {
  const s = getState()
  if (!s.resumePrompt) setState({ resumePrompt: id, tab: 'transfer' })
}
export function confirmResume(id) {
  return startTransfer(id)
}
export function dismissResume() {
  setState({ resumePrompt: null })
}

// ---- 调度：并发数、优先级、限速 --------------------------------------------
function candidates(s) {
  const mine = Object.values(s.transfers).filter(
    (t) => t.from === s.me?.id && t.state === 'sending' && ctl.has(t.id) && files.has(t.id) && !s.paused[t.id] && ctl.get(t.id).next < t.size,
  )
  const rank = (t) => {
    const i = s.priority.indexOf(t.id)
    return i === -1 ? 1e6 : i
  }
  return mine.sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
}
export function activeIds(s = getState()) {
  return candidates(s).slice(0, concurrencyLimit(s)).map((t) => t.id)
}

async function pumpOne(id, allowance) {
  const c = ctl.get(id)
  const file = files.get(id)
  const t = getState().transfers[id]
  if (!c || !file || !t || c.busy) return 0
  c.busy = true
  let used = 0
  try {
    while (isOpen() && bufferedAmount() < MAX_BUFFER && c.next < t.size) {
      const want = Math.min(MAX_CHUNK, t.size - c.next, allowance - used)
      if (want < 1024 && t.size - c.next >= 1024) break
      if (want <= 0) break
      const start = c.next
      const bytes = new Uint8Array(await file.slice(start, start + want).arrayBuffer())
      const cur = getState().transfers[id]
      if (!isOpen() || ctl.get(id) !== c || c.next !== start || cur?.state !== 'sending' || getState().paused[id]) break
      sendChunk(id, start, bytes)
      c.next += bytes.length
      used += bytes.length
    }
  } finally {
    c.busy = false
  }
  return used
}

setInterval(() => {
  const now = performance.now()
  const dt = (now - lastTick) / 1000
  lastTick = now
  const s = getState()
  if (s.link !== 'online') return
  const act = activeIds(s)
  const cap = s.limitKBps > 0 ? s.limitKBps * 1024 : Infinity
  if (cap !== Infinity) bucket = Math.min(bucket + cap * dt, cap * 0.5)
  if (!act.length) {
    bucket = 0
    return
  }
  const each = cap === Infinity ? MAX_CHUNK * 24 : Math.floor(bucket / act.length)
  if (each < 1) return
  for (const id of act) {
    if (cap !== Infinity) bucket -= each
    pumpOne(id, each).then((used) => {
      if (cap !== Infinity) bucket += each - used
    })
  }
}, TICK_MS)

// ---- 服务端事件 ------------------------------------------------------------
onEvent('file.state', ({ transfer }) => {
  const before = getState().transfers[transfer.id]
  patchTransfer(transfer)
  const s = getState()
  const mineSend = transfer.from === s.me?.id
  if (transfer.state === 'accepted' && mineSend && files.has(transfer.id) && !ctl.has(transfer.id)) startTransfer(transfer.id)
  if (transfer.state === 'interrupted' && mineSend) ctl.delete(transfer.id)
  if (before && before.state !== transfer.state) {
    if (transfer.state === 'done') toast('传输完成', `${transfer.name} · SHA-256 一致`)
    if (transfer.state === 'failed') toast('校验失败', transfer.reason || transfer.name)
    if (transfer.state === 'interrupted' && transfer.to === s.me?.id) toast('对方的传输中断了', `${transfer.name} 已确认 ${formatBytes(transfer.confirmed)}`)
    if (transfer.state === 'offered' && transfer.to === s.me?.id) toast('收到文件请求', `${transfer.name}（${formatBytes(transfer.size)}）`)
    log('file', `${transfer.name}：${transfer.state}`)
  } else if (!before && transfer.state === 'offered' && transfer.to === s.me?.id) {
    toast('收到文件请求', `${transfer.name}（${formatBytes(transfer.size)}）`)
  }
})

onEvent('file.progress', (m) => {
  const s = getState()
  const t = s.transfers[m.id]
  if (!t) return
  const now = performance.now()
  const prev = lastProgress.get(m.id)
  let rate = s.rates[m.id] || 0
  if (prev && now > prev.at) {
    const inst = ((m.confirmed - prev.bytes) / (now - prev.at)) * 1000
    rate = rate ? rate * 0.6 + inst * 0.4 : inst
  }
  lastProgress.set(m.id, { at: now, bytes: m.confirmed })
  const sessions = t.sessions.slice()
  if (m.session && sessions.length) sessions[sessions.length - 1] = m.session
  setState({
    transfers: { ...s.transfers, [m.id]: { ...t, confirmed: m.confirmed, sessions } },
    rates: { ...s.rates, [m.id]: Math.max(0, rate) },
  })
  if (m.confirmed === t.size && t.from === s.me?.id) finishTransfer(m.id)
})

onLink((link) => {
  if (link !== 'online') {
    ctl.clear()
    lastProgress.clear()
    bucket = 0
    setState({ rates: {} })
  }
})

// 重新连上以后：账本里自己发的、状态是“可恢复”的任务，如果文件还在内存里就提示续传
onEvent('hello', () => {
  const s = getState()
  for (const t of Object.values(s.transfers)) {
    if (t.from !== s.me.id) continue
    if (t.state === 'interrupted' && files.has(t.id)) promptResume(t.id)
    else if (t.state === 'accepted' && files.has(t.id)) startTransfer(t.id)
  }
})

// ---- 本地规则“智能方案”：没有接大模型。读真实的传输状态，给出可执行的调整 ----------
export function buildPlan() {
  const s = getState()
  const mine = Object.values(s.transfers).filter((t) => t.from === s.me?.id)
  const items = []
  const actions = []
  const remaining = (t) => t.size - t.confirmed

  const resumable = mine.filter((t) => t.state === 'interrupted' && files.has(t.id)).sort((a, b) => remaining(a) - remaining(b))
  const needFile = mine.filter((t) => t.state === 'interrupted' && !files.has(t.id))
  for (const t of resumable) {
    items.push(`先续传 ${t.name}：已确认 ${Math.round((t.confirmed / t.size) * 100)}%，只需再发 ${formatBytes(remaining(t))}`)
    actions.push({ type: 'resume', id: t.id })
  }
  for (const t of needFile) items.push(`${t.name} 需要重新选择原文件后才能续传（页面刷新过，文件句柄已丢失）`)

  const live = mine.filter((t) => ['sending', 'accepted'].includes(t.state) && files.has(t.id)).sort((a, b) => remaining(a) - remaining(b))
  if (live.length >= 2) {
    items.push(`按剩余量从小到大排队：${live.map((t) => t.name).join(' → ')}，大文件给小文件让路`)
    actions.push({ type: 'order', ids: live.map((t) => t.id) })
  }
  if (s.quality === '差' && s.policy !== 'save') {
    items.push(`当前链路质量差（RTT ${s.rtt ?? '—'} ms），改用省电优先，降低并发`)
    actions.push({ type: 'policy', policy: 'save' })
  } else if (live.length + resumable.length > 3 && s.policy === 'speed') {
    items.push('同时任务超过 3 个，改用公平优先，避免互相抢带宽')
    actions.push({ type: 'policy', policy: 'fair' })
  }
  if (!items.length) items.push('目前没有需要调整的传输。')
  return { items, actions }
}

export async function applyPlan(plan) {
  for (const a of plan.actions) {
    if (a.type === 'policy') setState({ policy: a.policy })
    if (a.type === 'order') setState({ priority: a.ids })
  }
  for (const a of plan.actions) if (a.type === 'resume') await startTransfer(a.id)
  log('plan', `已执行方案（${plan.actions.length} 项操作）`)
  toast('方案已生效', `共执行 ${plan.actions.length} 项操作`)
}
