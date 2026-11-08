import { IconCam, IconLeave, IconMic, IconShare } from '../icons.jsx'

const TILES = [
  { id: 'me', name: '吕奕萱（我）', initials: '吕', me: true },
  { id: 'lin', name: '林晓', initials: '林' },
  { id: 'dong', name: '董苟', initials: '董' },
  { id: 'wang', name: '王老师', initials: '王' },
]

export default function MeetingView({ inMeet, onJoin, onLeave, muted, camOff, setMuted, setCamOff, onShare }) {
  if (!inMeet) {
    return (
      <section className="pane">
        <div className="pane-head">
          <div>
            <h2>会议</h2>
            <div className="sub">像腾讯会议的进房，但没有中心 MCU，音视频走点对点网格</div>
          </div>
        </div>
        <div className="settings">
          <div className="panel">
            <h3>答辩彩排</h3>
            <p className="meta">4 人 · ReliaTox 房间 · 端到端</p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <button className="teal-btn" onClick={onJoin} type="button">加入会议</button>
              <button className="plain-btn" onClick={onJoin} type="button">新建房间</button>
            </div>
          </div>
          <div className="panel">
            <h3>和腾讯会议不同的地方</h3>
            <p className="meta">没有会议服务器转码。成员用 Tox ID 进房。断线后文件续传仍走同一套本地账本。</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="pane meet">
      <div className="pane-head" style={{ background: '#101820', color: '#e8eef4', borderColor: '#24313c' }}>
        <div>
          <h3>答辩彩排</h3>
          <div className="sub" style={{ color: '#9aafbd' }}>P2P 网格 · 4 人 · 无中心服务器</div>
        </div>
      </div>
      <div className="meet-grid">
        {TILES.map((t) => (
          <div className={`tile ${t.me ? 'me' : ''}`} key={t.id}>
            <b>{t.initials}</b>
            <span>{t.name}{t.me && camOff ? ' · 摄像头关' : ''}{t.me && muted ? ' · 静音' : ''}</span>
          </div>
        ))}
      </div>
      <div className="dock">
        <button className={muted ? 'bad' : ''} onClick={() => setMuted(!muted)} type="button"><IconMic /></button>
        <button className={camOff ? 'bad' : ''} onClick={() => setCamOff(!camOff)} type="button"><IconCam /></button>
        <button onClick={onShare} type="button"><IconShare /></button>
        <button className="bad" onClick={onLeave} type="button"><IconLeave /></button>
      </div>
    </section>
  )
}
