import { ME } from '../data.js'

export default function ContactsView({ friends, toxInput, setToxInput, onAdd, onChat }) {
  return (
    <>
      <aside className="col list-col">
        <div className="list-head"><h2>通讯录</h2></div>
        <div className="add-row">
          <input
            value={toxInput}
            onChange={(e) => setToxInput(e.target.value)}
            placeholder="粘贴对方 Tox ID"
          />
          <button className="teal-btn" onClick={onAdd} type="button">添加</button>
        </div>
        <div className="scroll">
          {friends.map((f) => (
            <button key={f.id} className="row-item" onClick={() => onChat(f.id)} type="button">
              <span className="avatar" style={{ background: f.color }}>{f.initials}</span>
              <span className="grow">
                <b>{f.name}</b>
                <span>{f.presence}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="pane">
        <div className="pane-head">
          <div>
            <h2>用 Tox ID 加人</h2>
            <div className="sub">没有搜索号，没有腾讯账号。身份密钥只在本机。</div>
          </div>
        </div>
        <div className="settings" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel">
            <h3>我的 Tox ID</h3>
            <div className="toxid">{ME.toxId}</div>
            <p className="meta" style={{ marginTop: 10 }}>对方用这一串加人。离线消息先存在本机，对方上线再送出。</p>
          </div>
        </div>
      </section>
    </>
  )
}
