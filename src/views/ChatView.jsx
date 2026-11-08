import { useEffect, useMemo, useRef, useState } from 'react'
import { IconPhone, IconPlus, IconSend, IconTransfer, IconVideo } from '../icons.jsx'
import { loadHistory, openChat, sendText } from '../net/client.js'
import { accept, cancel, reattach, sendFile, startTransfer, hasFile } from '../net/transfers.js'
import { startCall } from '../net/meeting.js'
import { setState, toast, useApp } from '../net/store.js'
import { avatarColor, clock, formatBytes, initials } from '../lib/format.js'

export function Avatar({ name, id, size }) {
  return (
    <div className="avatar" style={{ background: avatarColor(id || name), ...(size ? { width: size, height: size, fontSize: size * 0.4 } : null) }}>
      {initials(name)}
    </div>
  )
}

const STATE_LABEL = {
  offered: '等待对方接收',
  accepted: '准备发送',
  sending: '传输中',
  interrupted: '已中断，可续传',
  verifying: '校验中',
  done: '已完成',
  failed: '校验失败',
  canceled: '已取消',
}

function FileBubble({ msg }) {
  const { transfers, me, paused, token, link } = useApp()
  const t = transfers[msg.transferId]
  const pickRef = useRef(null)
  if (!t) return <div className="file-chip"><div className="file-ico">FILE</div><div>{msg.text}</div></div>
  const pct = Math.round((t.confirmed / t.size) * 100)
  const sender = t.from === me.id
  return (
    <div className="file-card">
      <div className="file-chip">
        <div className="file-ico">{(t.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</div>
        <div className="grow">
          <b className="ellipsis" style={{ display: 'block' }}>{t.name}</b>
          <span className="meta">{formatBytes(t.size)} · {paused[t.id] && t.state === 'sending' ? '已暂停' : STATE_LABEL[t.state]}</span>
        </div>
      </div>
      {['sending', 'interrupted', 'verifying'].includes(t.state) ? (
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      ) : null}
      {t.state === 'failed' ? <div className="meta" style={{ color: 'var(--danger)' }}>{t.reason}</div> : null}
      <div className="btn-row" style={{ marginTop: 6 }}>
        {t.state === 'offered' && !sender ? (
          <>
            <button className="teal-btn small" type="button" onClick={() => accept(t.id)}>接收</button>
            <button className="plain-btn small" type="button" onClick={() => cancel(t.id)}>拒绝</button>
          </>
        ) : null}
        {t.state === 'offered' && sender ? <button className="plain-btn small" type="button" onClick={() => cancel(t.id)}>撤回</button> : null}
        {t.state === 'interrupted' && sender && link === 'online' ? (
          hasFile(t.id) ? (
            <button className="amber-btn small" type="button" onClick={() => startTransfer(t.id)}>续传</button>
          ) : (
            <>
              <button className="amber-btn small" type="button" onClick={() => pickRef.current?.click()}>选择原文件续传</button>
              <input ref={pickRef} type="file" hidden onChange={(e) => e.target.files[0] && reattach(t.id, e.target.files[0])} />
            </>
          )
        ) : null}
        {t.state === 'done' ? (
          <a className="teal-btn small" href={`/api/files/${t.id}?token=${token}`} download={t.name}>下载</a>
        ) : null}
        {['sending', 'accepted', 'interrupted'].includes(t.state) ? (
          <button className="plain-btn small" type="button" onClick={() => setState({ tab: 'transfer' })}>
            <IconTransfer /> 传输详情
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function ChatView() {
  const { friends, activeId, messages, me, unread, hashing, link, tab } = useApp()
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState('')
  const [drag, setDrag] = useState(false)
  const logRef = useRef(null)
  const fileRef = useRef(null)
  const active = friends.find((f) => f.id === activeId)
  const list = messages[activeId] || []

  useEffect(() => {
    if (activeId) loadHistory(activeId)
  }, [activeId, link])
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [list.length, activeId])
  useEffect(() => {
    if (tab === 'chat' && activeId) setState((s) => (s.unread[activeId] ? { unread: { ...s.unread, [activeId]: 0 } } : null))
  }, [tab, activeId, list.length])

  const shown = useMemo(() => friends.filter((f) => f.username.toLowerCase().includes(filter.toLowerCase())), [friends, filter])
  const hashingHere = Object.values(hashing)

  async function submit() {
    const text = draft.trim()
    if (!text || !active) return
    setDraft('')
    try {
      await sendText(active.id, text)
    } catch (e) {
      setDraft(text)
      toast('发送失败', e.message)
    }
  }
  const pick = (files) => {
    if (!active) return
    for (const f of files) sendFile(active.id, f)
  }

  return (
    <>
      <aside className="col list-col">
        <div className="list-head">
          <h2>会话</h2>
          <button className="icon-btn" type="button" title="添加好友" onClick={() => setState({ modal: { type: 'add' } })}><IconPlus /></button>
        </div>
        <input className="search" placeholder="搜索好友" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="scroll">
          {shown.map((f) => {
            const last = (messages[f.id] || []).at(-1)
            return (
              <button key={f.id} className={`row-item ${f.id === activeId ? 'active' : ''}`} type="button" onClick={() => openChat(f.id)}>
                <div className="avatar-wrap">
                  <Avatar name={f.username} id={f.id} />
                  <i className={`presence ${f.online ? 'on' : ''}`} />
                </div>
                <div className="grow">
                  <b className="ellipsis">{f.username}</b>
                  <span className="ellipsis" style={{ display: 'block' }}>
                    {last ? (last.type === 'file' ? `[文件] ${last.text}` : last.text) : f.online ? '在线' : '离线'}
                  </span>
                </div>
                {unread[f.id] ? <span className="badge inline">{unread[f.id]}</span> : last ? <span className="time">{clock(last.at)}</span> : null}
              </button>
            )
          })}
          {!friends.length ? (
            <div className="empty small">
              <div>
                还没有好友<br />
                <button className="teal-btn" style={{ marginTop: 10 }} type="button" onClick={() => setState({ modal: { type: 'add' } })}>添加好友</button>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <section
        className={`col main ${drag ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick([...e.dataTransfer.files]) }}
      >
        {active ? (
          <>
            <div className="pane-head">
              <div className="head-who">
                <Avatar name={active.username} id={active.id} size={36} />
                <div>
                  <h3>{active.username}</h3>
                  <div className="sub">{active.online ? '在线' : '离线 · 消息会保存，对方上线后可见'}</div>
                </div>
              </div>
              <div className="btn-row">
                <button className="icon-btn" type="button" title="语音通话" disabled={!active.online} onClick={() => startCall(active.id, 'audio')}><IconPhone /></button>
                <button className="icon-btn" type="button" title="视频通话" disabled={!active.online} onClick={() => startCall(active.id, 'video')}><IconVideo /></button>
              </div>
            </div>
            <div className="chat-log scroll" ref={logRef}>
              {!list.length ? <div className="day-chip">还没有消息，打个招呼吧</div> : null}
              {list.map((m) => {
                const mine = m.from === me.id
                return (
                  <div key={m.id} className={`msg ${mine ? 'mine' : 'theirs'}`}>
                    <Avatar name={mine ? me.username : active.username} id={mine ? me.id : active.id} size={32} />
                    <div>
                      <div className="bubble">{m.type === 'file' ? <FileBubble msg={m} /> : m.text}</div>
                      <div className="stamp">{clock(m.at)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="composer">
              {hashingHere.map((h) => (
                <div className="meta" key={h.name}>正在计算 {h.name} 的 SHA-256：{h.pct}%</div>
              ))}
              <div className="composer-tools">
                <button className="icon-btn" type="button" title="发送文件" onClick={() => fileRef.current?.click()}><IconTransfer /></button>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => { pick([...e.target.files]); e.target.value = '' }} />
                <span className="meta" style={{ alignSelf: 'center' }}>也可以把文件直接拖进来</span>
              </div>
              <div className="composer-row">
                <textarea
                  value={draft}
                  placeholder={link === 'online' ? '输入消息，Enter 发送，Shift+Enter 换行' : '当前没有连接'}
                  disabled={link !== 'online'}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                />
                <button className="teal-btn" type="button" onClick={submit} disabled={!draft.trim() || link !== 'online'}><IconSend /> 发送</button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">{friends.length ? '选一个好友开始聊天' : '先添加一个好友。开另一个浏览器窗口注册第二个账号即可测试。'}</div>
        )}
      </section>
    </>
  )
}
