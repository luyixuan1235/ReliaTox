// 会议：服务端只转发信令；音视频是浏览器之间的 WebRTC 网状连接（每两个人一条 PeerConnection）。
import { isOpen, onEvent, onLink, request, send } from './client.js'
import { getState, log, setState, toast } from './store.js'

const pcs = new Map() // peerId -> { pc, polite, makingOffer, ignoreOffer, remote, audioTx, videoTx, meter }
let micTrack = null
let camTrack = null
let screenTrack = null
let preview = null // 本地预览用的 MediaStream
let localMeter = null
let audioCtx = null
let rev = 0

const meet = () => getState().meet
const patchMeet = (patch) => setState((s) => (s.meet ? { meet: { ...s.meet, ...(typeof patch === 'function' ? patch(s.meet) : patch) } } : null))
const bump = () => patchMeet({ rev: ++rev })

export const streamOf = (peerId) => (peerId === 'local' ? preview : pcs.get(peerId)?.remote || null)
export const meterOf = (peerId) => (peerId === 'local' ? localMeter : pcs.get(peerId)?.meter || null)

function makeMeter(track) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const src = audioCtx.createMediaStreamSource(new MediaStream([track]))
    const an = audioCtx.createAnalyser()
    an.fftSize = 256
    src.connect(an)
    const buf = new Uint8Array(an.fftSize)
    return {
      level() {
        an.getByteTimeDomainData(buf)
        let m = 0
        for (const v of buf) m = Math.max(m, Math.abs(v - 128))
        return Math.min(1, m / 56)
      },
      stop() {
        try {
          src.disconnect()
        } catch {}
      },
    }
  } catch {
    return null
  }
}

function rebuildPreview() {
  const tracks = [screenTrack || camTrack].filter(Boolean)
  preview = tracks.length ? new MediaStream(tracks) : null
  bump()
}
const publishState = () => {
  const m = meet()
  if (!m) return
  send('meet.state', { room: m.room.id, state: { audio: m.audio, video: m.video, sharing: m.sharing } })
}

// ---- 取摄像头 / 麦克风 -----------------------------------------------------
function explain(e) {
  if (!window.isSecureContext) return '浏览器只允许在 localhost 或 HTTPS 页面使用摄像头和麦克风。请用 http://localhost:8787 打开，或给服务配 HTTPS。'
  if (e?.name === 'NotAllowedError') return '你拒绝了权限，或浏览器地址栏左侧的权限被设为“阻止”。'
  if (e?.name === 'NotFoundError') return '没有检测到这个设备。'
  if (e?.name === 'NotReadableError') return '设备正被别的程序占用（比如另一个浏览器窗口或其它会议软件）。'
  return e?.message || String(e)
}
async function getMedia(kind) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('这个浏览器环境不支持 getUserMedia')
  const stream = await navigator.mediaDevices.getUserMedia(
    kind === 'audio'
      ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
      : { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } },
  )
  return stream.getTracks()[0]
}

async function openMic(notes) {
  try {
    micTrack = await getMedia('audio')
    localMeter?.stop()
    localMeter = makeMeter(micTrack)
    return true
  } catch (e) {
    notes.push(`麦克风：${explain(e)}`)
    return false
  }
}
async function openCam(notes) {
  try {
    camTrack = await getMedia('video')
    camTrack.onended = () => {
      if (camTrack) closeCam()
    }
    return true
  } catch (e) {
    notes.push(`摄像头：${explain(e)}`)
    return false
  }
}
function closeCam() {
  camTrack?.stop()
  camTrack = null
  syncVideoSenders()
  rebuildPreview()
  patchMeet({ video: false })
  publishState()
}
const outgoingVideo = () => screenTrack || camTrack || null
function syncVideoSenders() {
  for (const e of pcs.values()) e.videoTx?.sender.replaceTrack(outgoingVideo()).catch(() => {})
}

// ---- PeerConnection（完美协商） --------------------------------------------
function signal(to, data) {
  const m = meet()
  if (m) send('meet.signal', { room: m.room.id, to, data })
}

// initiator = 后加入会议的一方。每一对人只有一个发起方，避免两边同时发 offer（glare）。
// 先在会议里的人是应答方：等 offer 到了，再把自己的轨道挂到对方 offer 里的收发器上。
function createPc(peerId, initiator) {
  const e = {
    pc: new RTCPeerConnection({ iceServers: getState().iceServers }),
    polite: !initiator,
    makingOffer: false,
    ignoreOffer: false,
    remote: new MediaStream(),
    meter: null,
  }
  const { pc } = e
  if (initiator) {
    e.audioTx = pc.addTransceiver(micTrack || 'audio', { direction: 'sendrecv' })
    e.videoTx = pc.addTransceiver(outgoingVideo() || 'video', { direction: 'sendrecv' })
  }
  pc.ontrack = ({ track }) => {
    if (!e.remote.getTracks().includes(track)) e.remote.addTrack(track)
    if (track.kind === 'audio' && !e.meter) e.meter = makeMeter(track)
    bump()
  }
  pc.onicecandidate = ({ candidate }) => candidate && signal(peerId, { candidate })
  pc.onnegotiationneeded = async () => {
    try {
      e.makingOffer = true
      await pc.setLocalDescription()
      signal(peerId, { description: pc.localDescription })
    } catch (err) {
      console.error(err)
    } finally {
      e.makingOffer = false
    }
  }
  pc.onconnectionstatechange = () => {
    patchMeet((cur) => ({ peers: cur.peers.map((p) => (p.peerId === peerId ? { ...p, conn: pc.connectionState } : p)) }))
    if (pc.connectionState === 'failed') pc.restartIce()
  }
  pcs.set(peerId, e)
  return e
}

function adoptTransceivers(e) {
  for (const tx of e.pc.getTransceivers()) {
    const kind = tx.receiver.track.kind
    if (kind === 'audio' && !e.audioTx) {
      e.audioTx = tx
      tx.direction = 'sendrecv'
      tx.sender.replaceTrack(micTrack).catch(() => {})
    } else if (kind === 'video' && !e.videoTx) {
      e.videoTx = tx
      tx.direction = 'sendrecv'
      tx.sender.replaceTrack(outgoingVideo()).catch(() => {})
    }
  }
}

async function onSignal({ from, data }) {
  if (!meet()) return
  const e = pcs.get(from) || createPc(from, false)
  const { pc } = e
  try {
    if (data.description) {
      const collision = data.description.type === 'offer' && (e.makingOffer || pc.signalingState !== 'stable')
      e.ignoreOffer = !e.polite && collision
      if (e.ignoreOffer) return
      await pc.setRemoteDescription(data.description)
      if (data.description.type === 'offer') {
        adoptTransceivers(e)
        await pc.setLocalDescription()
        signal(from, { description: pc.localDescription })
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate)
      } catch (err) {
        if (!e.ignoreOffer) throw err
      }
    }
  } catch (err) {
    console.error('信令处理失败', err)
  }
}

function dropPeer(peerId) {
  const e = pcs.get(peerId)
  if (!e) return
  e.meter?.stop()
  e.pc.close()
  pcs.delete(peerId)
}

// ---- 对外操作 --------------------------------------------------------------
async function enter(res, { audio, video }) {
  const notes = []
  setState({
    meet: {
      room: res.room, peerId: res.peerId, peers: res.peers.map((p) => ({ ...p, conn: 'new' })),
      audio: false, video: false, sharing: false, notes, rev: 0, panel: false,
    },
  })
  if (audio) await openMic(notes)
  if (video) await openCam(notes)
  rebuildPreview()
  patchMeet({ audio: !!micTrack, video: !!camTrack, notes: [...notes] })
  publishState()
  for (const p of res.peers) if (!pcs.has(p.peerId)) createPc(p.peerId, true)
  // 申请权限期间对方的 offer 可能已经到了，那些连接是在没有本地轨道时建的，这里补上
  for (const e of pcs.values()) {
    e.audioTx?.sender.replaceTrack(micTrack).catch(() => {})
    e.videoTx?.sender.replaceTrack(outgoingVideo()).catch(() => {})
  }
  log('meet', `加入会议 ${res.room.id}`)
}

export async function createRoom({ title, audio = true, video = true } = {}) {
  if (meet()) await leave()
  const res = await request('meet.create', { title })
  await enter(res, { audio, video })
  return res.room.id
}
export async function joinRoom(code, { audio = true, video = true } = {}) {
  if (meet()) await leave()
  const res = await request('meet.join', { room: code })
  await enter(res, { audio, video })
}

export async function leave() {
  const m = meet()
  if (!m) return
  if (isOpen()) send('meet.leave', {})
  teardown()
  log('meet', `离开会议 ${m.room.id}`)
}
function teardown() {
  for (const id of [...pcs.keys()]) dropPeer(id)
  micTrack?.stop()
  camTrack?.stop()
  screenTrack?.stop()
  micTrack = camTrack = screenTrack = null
  localMeter?.stop()
  localMeter = null
  preview = null
  setState({ meet: null })
}

export async function toggleAudio() {
  const m = meet()
  if (!m) return
  if (!micTrack) {
    const notes = []
    if (await openMic(notes)) {
      for (const e of pcs.values()) await e.audioTx?.sender.replaceTrack(micTrack)
    } else toast('打不开麦克风', notes.join(' '))
  } else micTrack.enabled = !micTrack.enabled
  patchMeet({ audio: !!micTrack && micTrack.enabled })
  publishState()
}

export async function toggleVideo() {
  const m = meet()
  if (!m) return
  if (camTrack) return closeCam()
  const notes = []
  if (!(await openCam(notes))) return toast('打不开摄像头', notes.join(' '))
  syncVideoSenders()
  rebuildPreview()
  patchMeet({ video: true })
  publishState()
}

export async function toggleShare() {
  const m = meet()
  if (!m) return
  if (screenTrack) return stopShare()
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    screenTrack = stream.getVideoTracks()[0]
    screenTrack.onended = stopShare
    syncVideoSenders()
    rebuildPreview()
    patchMeet({ sharing: true })
    publishState()
  } catch (e) {
    if (e?.name !== 'NotAllowedError') toast('无法共享屏幕', explain(e))
  }
}
function stopShare() {
  if (!screenTrack) return
  screenTrack.stop()
  screenTrack = null
  syncVideoSenders()
  rebuildPreview()
  patchMeet({ sharing: false })
  publishState()
}

export async function invite(friendId) {
  const m = meet()
  if (!m) return
  const { delivered } = await request('meet.invite', { room: m.room.id, to: friendId })
  const f = getState().friends.find((x) => x.id === friendId)
  toast(delivered ? '邀请已发出' : '对方不在线', delivered ? `${f?.username} 的屏幕上会弹出邀请` : `${f?.username} 上线后需要你再邀请一次`)
}

// 一对一语音 / 视频：就是新开一个会议，再把对方邀请进来
export async function startCall(friendId, kind) {
  const f = getState().friends.find((x) => x.id === friendId)
  try {
    await createRoom({ title: `${getState().me.username} 和 ${f?.username} 的${kind === 'video' ? '视频' : '语音'}通话`, audio: true, video: kind === 'video' })
    setState({ tab: 'meet' })
    await invite(friendId)
  } catch (e) {
    toast('呼叫失败', e.message)
  }
}

export async function acceptInvite() {
  const inv = getState().invite
  setState({ invite: null, tab: 'meet' })
  if (!inv) return
  try {
    await joinRoom(inv.room.id, { audio: true, video: true })
  } catch (e) {
    toast('加入失败', e.message)
  }
}
export const declineInvite = () => setState({ invite: null })

// ---- 服务端事件 ------------------------------------------------------------
onEvent('meet.signal', onSignal)
onEvent('meet.peer-joined', ({ peer }) => {
  if (!meet()) return
  patchMeet((cur) => ({ peers: [...cur.peers.filter((p) => p.peerId !== peer.peerId), { ...peer, conn: 'new' }] }))
  // 不在这里建连接：新加入的人会主动向我们发 offer，到时再按需创建应答方
  toast('有人加入会议', peer.name)
})
onEvent('meet.peer-left', ({ peerId }) => {
  const p = meet()?.peers.find((x) => x.peerId === peerId)
  dropPeer(peerId)
  patchMeet((cur) => ({ peers: cur.peers.filter((x) => x.peerId !== peerId) }))
  if (p) toast('有人离开会议', p.name)
})
onEvent('meet.peer-state', ({ peerId, state }) => {
  patchMeet((cur) => ({ peers: cur.peers.map((p) => (p.peerId === peerId ? { ...p, state } : p)) }))
})
onEvent('meet.invite', (m) => {
  setState({ invite: m })
  log('meet', `${m.from.username} 邀请你加入会议 ${m.room.id}`)
})
onLink((link) => {
  if (link !== 'online' && meet()) {
    teardown()
    toast('会议已断开', '网络断开，已退出当前会议')
  }
})
