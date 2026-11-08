import { logout } from '../net/client.js'
import { toast, useApp } from '../net/store.js'
import { clock } from '../lib/format.js'
import { Avatar } from './ChatView.jsx'

export default function SettingsView() {
  const { me, events, iceServers } = useApp()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(me.toxId)
      toast('已复制', '')
    } catch {
      toast('复制失败', '请手动选中复制')
    }
  }
  return (
    <div className="pane">
      <div className="pane-head"><h2>我</h2></div>
      <div className="settings scroll">
        <div className="panel">
          <div className="head-who" style={{ marginBottom: 14 }}>
            <Avatar name={me.username} id={me.id} size={52} />
            <div><h3 style={{ margin: 0 }}>{me.username}</h3><div className="meta">已登录</div></div>
          </div>
          <div className="meta">我的 ID</div>
          <div className="toxid" style={{ marginTop: 6 }}>{me.toxId}</div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="plain-btn" type="button" onClick={copy}>复制 ID</button>
            <button className="danger-btn" type="button" onClick={logout}>退出登录</button>
          </div>
          <h3 style={{ marginTop: 22 }}>这个版本是什么</h3>
          <p className="meta" style={{ lineHeight: 1.7 }}>
            聊天和文件经由本服务转发并保存，没有端到端加密，也没有接入 toxcore。
            ID 是注册时由服务端生成的，格式和 Tox ID 相同。
            会议的音视频是浏览器之间的 WebRTC 直连，服务端只转发信令；
            {iceServers.length ? ` 已配置 ${iceServers.length} 个 ICE 服务。` : ' 当前没有配置 STUN/TURN，只能保证同一局域网内连通。'}
          </p>
        </div>
        <div className="panel">
          <h3>事件记录</h3>
          {events.length ? events.map((e) => (
            <div className="log-item" key={e.id}><b>{clock(e.at)}</b> · {e.text}</div>
          )) : <div className="meta">还没有事件。</div>}
        </div>
      </div>
    </div>
  )
}
