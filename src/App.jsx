import { useEffect } from 'react'
import { IconChat, IconMeet, IconMe, IconPeople, IconTransfer } from './icons.jsx'
import { restore } from './net/client.js'
import './net/transfers.js'
import { acceptInvite, declineInvite } from './net/meeting.js'
import { applyPlan, confirmResume, dismissResume } from './net/transfers.js'
import { setState, useApp } from './net/store.js'
import { exactBytes, formatBytes, hashBlocks, shortHash } from './lib/format.js'
import AuthView from './views/AuthView.jsx'
import ChatView, { Avatar } from './views/ChatView.jsx'
import ContactsView, { AddFriendForm } from './views/ContactsView.jsx'
import MeetingView from './views/MeetingView.jsx'
import SettingsView from './views/SettingsView.jsx'
import TransferView from './views/TransferView.jsx'
import Dialog from './components/Dialog.jsx'

const LINK_TEXT = { idle: '未连接', connecting: '连接中…', online: '在线', offline: '已断开，正在重连', manual: '已手动断开' }

function RailBtn({ icon, active, onClick, badge, label }) {
  return (
    <button className={`rail-btn ${active ? 'active' : ''}`} onClick={onClick} type="button" title={label} aria-label={label} aria-current={active ? 'page' : undefined}>
      {icon}
      <span className="rail-label">{label}</span>
      {badge ? <span className="badge">{typeof badge === 'number' && badge > 99 ? '99+' : badge}</span> : null}
    </button>
  )
}

function Modals() {
  const s = useApp()
  const { modal, resumePrompt, transfers, invite, plan } = s
  const resumeT = resumePrompt && transfers[resumePrompt]
  const close = () => setState({ modal: null })

  return (
    <>
      {resumeT && resumeT.state === 'interrupted' ? (
        <Dialog title="继续上次的传输" onClose={dismissResume}>
            <p className="meta">
              {resumeT.name} 上次已确认 {exactBytes(resumeT.confirmed)}，这次只需要再发 {exactBytes(resumeT.size - resumeT.confirmed)}。
            </p>
            <div className="proof light">
              <div className="proof-card"><em>已传 A</em><b>{exactBytes(resumeT.confirmed)}</b></div>
              <div className="proof-card"><em>需续传 B</em><b>{exactBytes(resumeT.size - resumeT.confirmed)}</b></div>
              <div className="proof-card"><em>文件大小</em><b>{exactBytes(resumeT.size)}</b></div>
              <div className="proof-card"><em>从偏移继续</em><b>{formatBytes(resumeT.confirmed)}</b></div>
            </div>
            <div className="hash-row" style={{ marginTop: 12 }}>
              <div className="blocks">{hashBlocks(resumeT.sha256).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
              <span className="mono">{shortHash(resumeT.sha256)}</span>
            </div>
            <div className="btn-row" style={{ marginTop: 18 }}>
              <button className="amber-btn" type="button" onClick={() => confirmResume(resumeT.id)}>确认续传</button>
              <button className="plain-btn" type="button" onClick={dismissResume}>暂不续传</button>
            </div>
        </Dialog>
      ) : null}

      {modal?.type === 'plan' && plan ? (
        <Dialog title="智能传输方案" onClose={close}>
            <p className="meta">根据当前传输状态生成的调度建议，确认后执行。</p>
            <ul className="plan-list">{plan.items.map((i) => <li key={i}>{i}</li>)}</ul>
            <div className="btn-row">
              {plan.actions.length ? (
                <button className="teal-btn" type="button" onClick={() => { close(); applyPlan(plan) }}>确认并执行</button>
              ) : null}
              <button className="plain-btn" type="button" onClick={close}>{plan.actions.length ? '取消' : '关闭'}</button>
            </div>
        </Dialog>
      ) : null}

      {modal?.type === 'add' ? (
        <Dialog title="添加好友" onClose={close}>
            <p className="meta">输入对方的用户名，或者他给你的 76 位 ID。</p>
            <AddFriendForm onDone={close} />
            <div className="btn-row"><button className="plain-btn" type="button" onClick={close}>取消</button></div>
        </Dialog>
      ) : null}

      {invite ? (
        <Dialog title={`${invite.from.username} 邀请你加入会议`} onClose={declineInvite} className="call-invite">
            <Avatar name={invite.from.username} id={invite.from.id} size={72} />
            <p className="meta">{invite.room.title} · 会议号 {invite.room.id}</p>
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <button className="teal-btn" type="button" onClick={acceptInvite}>加入</button>
              <button className="danger-btn" type="button" onClick={declineInvite}>拒绝</button>
            </div>
        </Dialog>
      ) : null}
    </>
  )
}

export default function App() {
  const s = useApp()
  const { boot, me, tab, link, rtt, quality, transfers, unread, meet, toasts } = s

  useEffect(() => {
    restore()
  }, [])

  if (boot) return <div className="app-root"><div className="boot">正在加载…</div></div>
  if (!me) return <AuthView />

  const needAction = Object.values(transfers).filter((t) => (t.from === me.id && t.state === 'interrupted') || (t.to === me.id && t.state === 'offered')).length
  const unreadTotal = Object.values(unread).reduce((a, b) => a + b, 0)
  const go = (t) => setState({ tab: t })

  return (
    <div className="app-root">
      <div className="desk">
        <header className="titlebar">
          <div className="brand-row"><span className="brand-mark" /><strong>ReliaTox</strong></div>
          <div className="pills">
            <span className="pill"><span className={`dot ${link === 'online' ? '' : link === 'connecting' || link === 'offline' ? 'warn' : 'off'}`} />{LINK_TEXT[link]}</span>
            {rtt != null ? <span className="pill network-detail" title="网络往返延迟">{rtt} ms · {quality}</span> : null}
            <span className="header-user" title={me.username}>{me.username}</span>
          </div>
        </header>

        <div className="workspace">
          <nav className="rail" aria-label="主导航">
            <div className="rail-avatar"><Avatar name={me.username} id={me.id} size={42} /></div>
            <RailBtn icon={<IconChat />} label="会话" active={tab === 'chat'} onClick={() => go('chat')} badge={unreadTotal} />
            <RailBtn icon={<IconPeople />} label="通讯录" active={tab === 'contacts'} onClick={() => go('contacts')} />
            <RailBtn icon={<IconTransfer />} label="传输" active={tab === 'transfer'} onClick={() => go('transfer')} badge={needAction} />
            <RailBtn icon={<IconMeet />} label="会议" active={tab === 'meet'} onClick={() => go('meet')} badge={meet ? '●' : 0} />
            <div className="rail-space" />
            <RailBtn icon={<IconMe />} label="我的" active={tab === 'me'} onClick={() => go('me')} />
          </nav>

          {tab === 'chat' ? <ChatView /> : null}
          {tab === 'contacts' ? <ContactsView /> : null}
          {tab === 'transfer' ? <TransferView /> : null}
          {tab === 'meet' ? <MeetingView /> : null}
          {tab === 'me' ? <SettingsView /> : null}

          {meet && tab !== 'meet' ? (
            <button className="meet-return" type="button" onClick={() => go('meet')}>会议进行中 · {meet.room.id} · 点击返回</button>
          ) : null}

          <Modals />

          <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
            {toasts.map((t) => (
              <div className="toast" key={t.id}><b>{t.title}</b>{t.text}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
