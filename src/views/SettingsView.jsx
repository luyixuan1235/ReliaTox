import { getBackendLog } from '../mock/backend.js'
import { ME } from '../data.js'

export default function SettingsView({ tick }) {
  const logs = getBackendLog()
  void tick

  return (
    <section className="pane">
      <div className="pane-head">
        <div>
          <h2>身份与后端挂钩</h2>
          <div className="sub">前端按钮已经按后端接口命名。现在点击会记一笔，接上 toxcore 后不用改界面。</div>
        </div>
      </div>
      <div className="settings">
        <div className="panel">
          <h3>{ME.name}</h3>
          <div className="toxid">{ME.toxId}</div>
          <p className="meta" style={{ marginTop: 12 }}>
            SQLCipher 传输账本 · 好友公钥 · resumeFileId · 已确认偏移 · SHA-256 中间态
          </p>
          <p className="meta">后端将接入：tox_file_send / tox_file_seek / tox_file_control / 本地 seek。</p>
        </div>
        <div className="panel">
          <h3>已点击的后端调用</h3>
          <div className="scroll" style={{ maxHeight: 420 }}>
            {logs.length === 0 ? <p className="meta">还没有点击。去传输页点「模拟断线」或「续传」。</p> : null}
            {logs.map((l) => (
              <div className="log-item" key={l.id}>
                <div className="meta">{l.at}</div>
                <b>{l.name}</b>
                <div className="meta">{l.result.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
