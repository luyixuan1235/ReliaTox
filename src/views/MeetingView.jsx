import { useEffect, useRef, useState } from 'react'
import { IconCam, IconLeave, IconMic, IconPeople, IconShare } from '../icons.jsx'
import { createRoom, invite, joinRoom, leave, meterOf, streamOf, toggleAudio, toggleShare, toggleVideo } from '../net/meeting.js'
import { toast, useApp } from '../net/store.js'
import { avatarColor, initials } from '../lib/format.js'

function Tile({ id, name, state, local, rev, conn }) {
  const ref = useRef(null)
  const [level, setLevel] = useState(0)
  const stream = streamOf(id)

  useEffect(() => {
    const el = ref.current
    if (el && el.srcObject !== stream) el.srcObject = stream
    el?.play?.().catch(() => {})
  }, [stream, rev])
  useEffect(() => {
    const timer = setInterval(() => setLevel(state.audio ? meterOf(id)?.level() || 0 : 0), 120)
    return () => clearInterval(timer)
  }, [id, state.audio])

  const showVideo = state.video || state.sharing
  return (
    <div className={`tile ${local ? 'me' : ''} ${level > 0.15 ? 'speaking' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={!!local} className={showVideo ? 'show' : ''} style={local && !state.sharing ? { transform: 'scaleX(-1)' } : undefined} />
      {!showVideo ? (
        <div className="tile-avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
      ) : null}
      <span className="tile-name">
        {state.audio ? null : <IconMic />}
        {name}{local ? '（我）' : ''}{state.sharing ? ' · 正在共享屏幕' : ''}
        {!local && conn && conn !== 'connected' ? ` · ${conn === 'failed' ? '连接失败' : '连接中…'}` : ''}
      </span>
      <div className="level"><i style={{ height: `${Math.round(level * 100)}%` }} /></div>
    </div>
  )
}

function Lobby() {
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [audio, setAudio] = useState(true)
  const [video, setVideo] = useState(true)
  const [busy, setBusy] = useState(false)
  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast('操作失败', e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="lobby">
      <div className="lobby-card">
        <h2>会议</h2>
        {!window.isSecureContext ? (
          <div className="form-error">当前页面不是 localhost 或 HTTPS，浏览器会禁止摄像头和麦克风。请改用 http://localhost:8787 打开。</div>
        ) : null}
        <fieldset className="join-settings">
          <legend>入会设置</legend>
          <label className="check"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> 打开麦克风</label>
          <label className="check"><input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} /> 打开摄像头</label>
          <p className="meta">创建或加入会议时，均使用以上设置。</p>
        </fieldset>
        <div className="lobby-split">
          <section>
            <h3>新建会议</h3>
            <label className="field-label">会议主题<input className="field" placeholder="例如：项目讨论（可不填）" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <button className="teal-btn" type="button" disabled={busy} onClick={() => run(() => createRoom({ title, audio, video }))}>创建新会议</button>
            <p className="meta">创建后会得到 6 位会议号，也可以在会议里直接邀请好友。</p>
          </section>
          <section>
            <h3>加入会议</h3>
            <label className="field-label">会议号<input className="field mono-in" placeholder="输入 6 位会议号" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim().toUpperCase())} /></label>
            <button className="plain-btn" type="button" disabled={busy || code.length !== 6} onClick={() => run(() => joinRoom(code, { audio, video }))}>加入会议</button>
          </section>
        </div>
      </div>
    </div>
  )
}

export default function MeetingView() {
  const { meet, me, friends } = useApp()
  const [panel, setPanel] = useState(false)
  if (!meet) return <Lobby />

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meet.room.id)
      toast('会议号已复制', meet.room.id)
    } catch {
      toast('会议号', meet.room.id)
    }
  }
  const tiles = [{ id: 'local', name: me.username, state: { audio: meet.audio, video: meet.video, sharing: meet.sharing }, local: true }, ...meet.peers.map((p) => ({ id: p.peerId, name: p.name, state: p.state || { audio: true, video: true, sharing: false }, conn: p.conn }))]
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3
  const inRoomIds = new Set(meet.peers.map((p) => p.userId))

  return (
    <div className="meet">
      <div className="meet-head">
        <div>
          <b>{meet.room.title}</b>
          <button type="button" className="room-code" onClick={copy} title="复制会议号">会议号 {meet.room.id}</button>
        </div>
        <span className="meta" style={{ color: '#9fb2c0' }}>{tiles.length} 人在会议中</span>
      </div>
      {meet.notes.length ? <div className="meet-note">{meet.notes.map((n) => <div key={n}>{n}</div>)}</div> : null}
      {meet.peers.some((p) => p.conn === 'failed') ? (
        <div className="meet-note">
          与 {meet.peers.filter((p) => p.conn === 'failed').map((p) => p.name).join('、')} 之间无法直连（ICE 失败）。
          常见原因：两人不在同一个局域网，或防火墙、VPN 拦住了 UDP。跨网络需要配置 TURN 中继，
          启动服务时设置环境变量 ICE_SERVERS，见 README。
        </div>
      ) : null}
      <div className="meet-body">
        <div className="meet-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {tiles.map((t) => <Tile key={t.id} {...t} rev={meet.rev} />)}
        </div>
        {panel ? (
          <aside className="meet-panel">
            <h4>邀请好友</h4>
            {friends.map((f) => (
              <div className="friend-row dark" key={f.id}>
                <div className="grow"><b>{f.username}</b><div className="meta">{inRoomIds.has(f.id) ? '已在会议中' : f.online ? '在线' : '离线'}</div></div>
                <button className="teal-btn small" type="button" disabled={!f.online || inRoomIds.has(f.id)} onClick={() => invite(f.id).catch((e) => toast('邀请失败', e.message))}>邀请</button>
              </div>
            ))}
            {!friends.length ? <div className="meta">还没有好友，先去通讯录添加。</div> : null}
            <p className="meta">没有加好友的人也可以直接输入会议号 {meet.room.id} 加入。</p>
          </aside>
        ) : null}
      </div>
      <div className="dock">
        <button type="button" className={meet.audio ? 'on' : 'off'} onClick={toggleAudio} title={meet.audio ? '静音' : '打开麦克风'}><IconMic /></button>
        <button type="button" className={meet.video ? 'on' : 'off'} onClick={toggleVideo} title={meet.video ? '关闭摄像头' : '打开摄像头'}><IconCam /></button>
        <button type="button" className={meet.sharing ? 'on' : ''} onClick={toggleShare} title="共享屏幕"><IconShare /></button>
        <button type="button" className={panel ? 'on' : ''} onClick={() => setPanel((v) => !v)} title="邀请好友"><IconPeople /></button>
        <button type="button" className="bad" onClick={leave} title="离开会议"><IconLeave /></button>
      </div>
    </div>
  )
}
