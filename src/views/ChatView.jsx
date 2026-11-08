import { IconLock, IconPhone, IconPlus, IconSend, IconVideo } from '../icons.jsx'

export default function ChatView({
  friends,
  activeId,
  setActiveId,
  messages,
  draft,
  setDraft,
  onSend,
  onSendFile,
  onOpenTransfer,
  onCall,
  onAdd,
  onTool,
}) {
  const friend = friends.find((f) => f.id === activeId)
  const list = messages[activeId] || []

  return (
    <>
      <aside className="col list-col">
        <div className="list-head">
          <h2>会话</h2>
          <button className="icon-btn" onClick={onAdd} title="加好友" type="button"><IconPlus /></button>
        </div>
        <input className="search" placeholder="搜索好友或 Tox ID" />
        <div className="scroll">
          {friends.map((f) => (
            <button
              key={f.id}
              className={`row-item ${activeId === f.id ? 'active' : ''}`}
              onClick={() => setActiveId(f.id)}
              type="button"
            >
              <span className="avatar" style={{ background: f.color }}>{f.initials}</span>
              <span className="grow">
                <b>{f.name}</b>
                <span className="ellipsis">{f.last}</span>
              </span>
              <span className="time">{f.time}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="col pane">
        {friend ? (
          <>
            <div className="pane-head">
              <div>
                <h3>{friend.name}</h3>
                <div className="sub">{friend.presence} · 端到端加密</div>
              </div>
              <div className="btn-row">
                <button className="icon-btn" onClick={() => onCall('voice')} type="button"><IconPhone /></button>
                <button className="icon-btn" onClick={() => onCall('video')} type="button"><IconVideo /></button>
              </div>
            </div>
            <div className="chat-log scroll">
              <div className="day-chip">今天 · 消息只在两端解密</div>
              {list.map((m) => (
                <div className={`msg ${m.from === 'me' ? 'mine' : 'theirs'}`} key={m.id}>
                  {m.type === 'file' ? (
                    <button className="bubble file-chip" onClick={onOpenTransfer} type="button">
                      <span className="file-ico">FILE</span>
                      <span>
                        <b>{m.name}</b>
                        <div className="meta">{m.size} · 点击查看传输</div>
                      </span>
                    </button>
                  ) : (
                    <div className="bubble">{m.text}</div>
                  )}
                </div>
              ))}
              <div className="e2e-note"><IconLock /> 无中心服务器中转原文</div>
            </div>
            <div className="composer">
              <div className="composer-tools">
                <button className="plain-btn" onClick={onSendFile} type="button">发文件</button>
                <button className="plain-btn" onClick={() => onTool('sendSticker')} type="button">表情</button>
                <button className="plain-btn" onClick={() => onTool('captureScreen')} type="button">截图</button>
              </div>
              <div className="composer-row">
                <textarea
                  placeholder="发消息，或从这里发起续传文件"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      onSend()
                    }
                  }}
                />
                <button className="teal-btn" onClick={onSend} type="button">发送</button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">选择一个会话</div>
        )}
      </section>
    </>
  )
}
