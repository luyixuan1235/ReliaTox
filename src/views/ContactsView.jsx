import { useState } from 'react'
import { addFriend, openChat } from '../net/client.js'
import { toast, useApp } from '../net/store.js'
import { Avatar } from './ChatView.jsx'
import { shortHash } from '../lib/format.js'

export function AddFriendForm({ onDone }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    try {
      const f = await addFriend(query.trim())
      setQuery('')
      onDone?.(f)
    } catch (err) {
      toast('添加失败', err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="add-row" onSubmit={submit}>
      <input aria-label="好友用户名或 ID" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="对方的用户名，或 76 位 ID" autoFocus />
      <button className="teal-btn" type="submit" disabled={busy || !query.trim()}>添加</button>
    </form>
  )
}

export default function ContactsView() {
  const { friends, me } = useApp()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(me.toxId)
      toast('已复制', '把它发给朋友，他用“添加好友”粘贴即可')
    } catch {
      toast('复制失败', '请手动选中复制')
    }
  }
  return (
    <div className="pane">
      <div className="pane-head">
        <div>
          <h2>通讯录</h2>
          <div className="sub">{friends.length} 位好友 · {friends.filter((f) => f.online).length} 位在线</div>
        </div>
      </div>
      <div className="contacts-grid scroll">
        <div className="panel">
          <h3>添加好友</h3>
          <p className="meta" style={{ marginTop: 0 }}>输入对方的用户名或 ID，添加后双方立即互为好友。</p>
          <AddFriendForm />
          <h3 style={{ marginTop: 18 }}>我的 ID</h3>
          <div className="toxid">{me.toxId}</div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="plain-btn" type="button" onClick={copy}>复制 ID</button>
          </div>
        </div>
        <div className="panel">
          <h3>好友</h3>
          {friends.length ? (
            <div className="friend-list">
              {friends.map((f) => (
                <div className="friend-row" key={f.id}>
                  <div className="avatar-wrap"><Avatar name={f.username} id={f.id} /><i className={`presence ${f.online ? 'on' : ''}`} /></div>
                  <div className="grow">
                    <b>{f.username}</b>
                    <div className="meta mono">{shortHash(f.toxId)}</div>
                  </div>
                  <button className="teal-btn small" type="button" onClick={() => openChat(f.id)}>发消息</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="meta">还没有好友。</div>
          )}
        </div>
      </div>
    </div>
  )
}
