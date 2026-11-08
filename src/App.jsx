import { useMemo, useState } from 'react'
import { callBackend } from './mock/backend.js'
import {
  COLORS,
  DEMO_HASH,
  FILE_SIZE,
  ME,
  OFFSET_A,
  REMAIN_B,
  initialFriends,
  initialJobs,
  initialMessages,
} from './data.js'
import { formatBytes, hashBlocks, shortHash } from './lib/format.js'
import { IconChat, IconLock, IconMeet, IconMe, IconPeople, IconTransfer } from './icons.jsx'
import ChatView from './views/ChatView.jsx'
import ContactsView from './views/ContactsView.jsx'
import MeetingView from './views/MeetingView.jsx'
import SettingsView from './views/SettingsView.jsx'
import TransferView from './views/TransferView.jsx'

export default function App() {
  const [phase, setPhase] = useState('gate')
  const [tab, setTab] = useState('chat')
  const [friends, setFriends] = useState(initialFriends)
  const [activeId, setActiveId] = useState('lin')
  const [messages, setMessages] = useState(initialMessages)
  const [jobs, setJobs] = useState(initialJobs)
  const [draft, setDraft] = useState('')
  const [toxInput, setToxInput] = useState('')
  const [policy, setPolicyState] = useState('fair')
  const [link, setLink] = useState('udp')
  const [quality, setQuality] = useState('好')
  const [proof, setProof] = useState(null)
  const [toasts, setToasts] = useState([])
  const [modal, setModal] = useState(null)
  const [call, setCall] = useState(null)
  const [inMeet, setInMeet] = useState(false)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [tick, setTick] = useState(0)

  const resumeCount = jobs.filter((j) => j.status === 'resume').length
  const demoJob = useMemo(() => jobs.find((j) => j.id === 'demo'), [jobs])

  function toast(title, text) {
    const id = crypto.randomUUID()
    setToasts((cur) => [...cur.slice(-3), { id, title, text }])
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3200)
  }

  async function hooked(name, payload, after) {
    const res = await callBackend(name, payload)
    setTick((n) => n + 1)
    toast('已请求后端', name)
    after?.(res)
    return res
  }

  function enter() {
    hooked('loadIdentity', { toxId: ME.toxId })
    setPhase('app')
  }

  function sendMessage() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setMessages((cur) => ({
      ...cur,
      [activeId]: [...(cur[activeId] || []), { id: Date.now(), from: 'me', type: 'text', text }],
    }))
    hooked('sendMessage', { friendId: activeId, text })
  }

  function openAiPlan(fromFileButton) {
    if (fromFileButton) setTab('transfer')
    setModal({
      type: 'plan',
      title: 'AI 传输方案',
      body: '本地规则已核对。确认后才调用暂停 / 继续 / seek。',
      items: [
        '先恢复 答辩录像.mp4（进度 41%，优先）',
        '并发 2 路：开题报告.pdf 与续传并行',
        '暂停 参考论文.zip（低优先级）',
        '数据集-part2.bin 给大文件让路，排在后面',
      ],
    })
  }

  function openResume(job) {
    setModal({
      type: 'resume',
      job,
      title: '检测到未完成传输',
      body: `${job.name} 已确认 ${formatBytes(job.confirmed)}，本次只续传 ${formatBytes(job.size - job.confirmed)}。`,
    })
  }

  async function confirmResume() {
    const job = modal?.job || demoJob
    setModal(null)
    if (!job) return
    await hooked('confirmResume', {
      resumeFileId: job.fileId,
      seek: job.confirmed,
      size: job.size,
    })
    setLink('udp')
    setJobs((cur) => cur.map((j) => (
      j.id === job.id
        ? { ...j, status: 'run', note: `正在 seek 到 ${formatBytes(j.confirmed)}，只传剩余部分` }
        : j
    )))
    window.setTimeout(() => {
      setJobs((cur) => cur.map((j) => (
        j.id === job.id
          ? {
              ...j,
              status: 'done',
              confirmed: j.size,
              sessionSent: j.size - OFFSET_A,
              hash: DEMO_HASH,
              note: `A ${formatBytes(OFFSET_A)} + B ${formatBytes(REMAIN_B)} = ${formatBytes(FILE_SIZE)} · 哈希一致`,
            }
          : j
      )))
      setProof({ a: OFFSET_A, b: REMAIN_B, match: true })
      toast('续传完成', '续传量一致，SHA-256 一致')
    }, 1400)
  }

  function disconnect() {
    hooked('simulateDisconnect', { reason: 'demo' })
    setLink('offline')
    setJobs((cur) => cur.map((j) => (
      j.status === 'run' || j.id === 'demo'
        ? { ...j, status: 'resume', note: '连接断开，进度已写入本地账本' }
        : j
    )))
    setTab('transfer')
    if (demoJob) openResume({ ...demoJob, status: 'resume' })
  }

  function reconnect() {
    hooked('reconnectFriend', { friendId: 'lin' })
    setLink('udp')
    toast('好友上线', '未完成传输仍在账本中')
  }

  async function applyPolicy(next) {
    setPolicyState(next)
    await hooked('setSchedulerPolicy', { policy: next })
    if (next === 'save' || next === 'fair') {
      setJobs((cur) => cur.map((j) => (
        j.id === 'zip' ? { ...j, status: 'wait', note: '策略让路，已暂停低优先级' } : j
      )))
    }
    if (next === 'speed') setQuality('好')
    if (next === 'save') setQuality('差')
  }

  function addFriend() {
    const id = toxInput.trim()
    if (!id) {
      setModal({ type: 'add' })
      return
    }
    const friend = {
      id: `f-${Date.now()}`,
      name: `好友 ${id.slice(0, 4)}`,
      initials: '友',
      color: COLORS[friends.length % COLORS.length],
      presence: '等待对方确认',
      last: '已发送好友请求',
      time: '现在',
    }
    setFriends((cur) => [friend, ...cur])
    setToxInput('')
    hooked('addFriend', { toxId: id })
  }

  function confirmPlan() {
    setModal(null)
    hooked('applyAiPlan', { policy, concurrent: quality === '差' ? 2 : 3 })
    toast('方案已生效', '后端将按顺序调用暂停和继续')
  }

  if (phase === 'gate') {
    return (
      <div className="app-root">
        <section className="gate">
          <div className="gate-left">
            <div className="brand-row">
              <span className="brand-mark" />
              <strong>ReliaTox</strong>
            </div>
            <h1>续到断点。<br />不必经过腾讯。</h1>
            <p>
              聊天、会议、传文件都在。和微信、腾讯会议相近的使用方式，但身份密钥在本机，
              传文件中断后从已确认偏移继续，最后用 SHA-256 验收。
            </p>
            <ul className="feature-list">
              <li><i /> 断点续传：已传 A + 续传 B = 文件大小</li>
              <li><i /> 自适应调度：速度 / 公平 / 省电</li>
              <li><i /> 开传和续传前，AI 方案先确认再执行</li>
            </ul>
            <button className="amber-btn" onClick={enter} type="button">生成本地身份并进入</button>
          </div>
          <div className="gate-right">
            <h2>续传演示</h2>
            <p className="meta">先点「模拟断线」，再确认续传。核对两项：续传量与 SHA-256。</p>
            <div className="gate-card">
              <div className="meta">我的 Tox ID</div>
              <div className="toxid" style={{ marginTop: 8 }}>{ME.toxId}</div>
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="app-root">
      <div className="desk">
        <header className="titlebar">
          <div className="brand-row">
            <span className="brand-mark" />
            <strong>ReliaTox</strong>
          </div>
          <div className="pills">
            <span className="pill"><span className={`dot ${link === 'offline' ? 'off' : ''}`} />{link === 'udp' ? 'UDP 直连' : link === 'relay' ? 'TCP Relay' : '已断线'}</span>
            <span className="pill"><IconLock /> E2E</span>
            <span className="pill">SQLCipher 账本</span>
            <button className="ghost-btn" onClick={disconnect} type="button">演示续传</button>
          </div>
        </header>

        <div className="workspace">
          <nav className="rail">
            <div className="rail-avatar">{ME.initials}</div>
            <RailBtn icon={<IconChat />} label="会话" active={tab === 'chat'} onClick={() => setTab('chat')} />
            <RailBtn icon={<IconPeople />} label="通讯录" active={tab === 'contacts'} onClick={() => setTab('contacts')} />
            <RailBtn icon={<IconTransfer />} label="传输" active={tab === 'transfer'} onClick={() => setTab('transfer')} badge={resumeCount} />
            <RailBtn icon={<IconMeet />} label="会议" active={tab === 'meet'} onClick={() => setTab('meet')} />
            <div className="rail-space" />
            <RailBtn icon={<IconMe />} label="我" active={tab === 'me'} onClick={() => setTab('me')} />
          </nav>

          {tab === 'chat' ? (
            <ChatView
              friends={friends}
              activeId={activeId}
              setActiveId={setActiveId}
              messages={messages}
              draft={draft}
              setDraft={setDraft}
              onSend={sendMessage}
              onSendFile={() => openAiPlan(true)}
              onOpenTransfer={() => setTab('transfer')}
              onTool={(name) => hooked(name, { friendId: activeId })}
              onCall={(kind) => {
                hooked('startCall', { friendId: activeId, kind })
                setCall({ kind, friend: friends.find((f) => f.id === activeId) })
              }}
              onAdd={() => setModal({ type: 'add' })}
            />
          ) : null}

          {tab === 'contacts' ? (
            <ContactsView
              friends={friends}
              toxInput={toxInput}
              setToxInput={setToxInput}
              onAdd={addFriend}
              onChat={(id) => {
                setActiveId(id)
                setTab('chat')
              }}
            />
          ) : null}

          {tab === 'transfer' ? (
            <TransferView
              jobs={jobs}
              policy={policy}
              setPolicy={applyPolicy}
              link={link}
              quality={quality}
              proof={proof}
              onResume={openResume}
              onAiPlan={() => openAiPlan(false)}
              onDisconnect={disconnect}
              onReconnect={reconnect}
            />
          ) : null}

          {tab === 'meet' ? (
            <MeetingView
              inMeet={inMeet}
              muted={muted}
              camOff={camOff}
              setMuted={setMuted}
              setCamOff={setCamOff}
              onJoin={() => {
                hooked('joinMeeting', { room: 'defense-rehearsal' })
                setInMeet(true)
              }}
              onLeave={() => {
                hooked('leaveMeeting', { room: 'defense-rehearsal' })
                setInMeet(false)
              }}
              onShare={() => hooked('shareScreen', { room: 'defense-rehearsal' })}
            />
          ) : null}

          {tab === 'me' ? <SettingsView tick={tick} /> : null}

          {modal?.type === 'resume' ? (
            <div className="modal-back" onClick={() => setModal(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>{modal.title}</h3>
                <p className="meta">{modal.body}</p>
                <div className="proof" style={{ marginTop: 14 }}>
                  <div className="proof-card" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
                    <em>已传 A</em><b>{formatBytes(OFFSET_A)}</b>
                  </div>
                  <div className="proof-card" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
                    <em>续传 B</em><b>{formatBytes(REMAIN_B)}</b>
                  </div>
                  <div className="proof-card" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
                    <em>合计</em><b>{formatBytes(FILE_SIZE)}</b>
                  </div>
                  <div className="proof-card" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
                    <em>seek</em><b>{formatBytes(OFFSET_A)}</b>
                  </div>
                </div>
                <div className="hash-row" style={{ marginTop: 12 }}>
                  <div className="blocks">{hashBlocks(DEMO_HASH).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
                  <span className="mono">{shortHash(DEMO_HASH)}</span>
                </div>
                <div className="btn-row" style={{ marginTop: 18 }}>
                  <button className="amber-btn" onClick={confirmResume} type="button">确认续传</button>
                  <button className="plain-btn" onClick={() => setModal(null)} type="button">暂不续传</button>
                </div>
              </div>
            </div>
          ) : null}

          {modal?.type === 'plan' ? (
            <div className="modal-back" onClick={() => setModal(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>{modal.title}</h3>
                <p className="meta">{modal.body}</p>
                <ul className="plan-list">
                  {modal.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <div className="btn-row">
                  <button className="teal-btn" onClick={confirmPlan} type="button">确认并执行</button>
                  <button className="plain-btn" onClick={() => setModal(null)} type="button">取消</button>
                </div>
              </div>
            </div>
          ) : null}

          {modal?.type === 'add' ? (
            <div className="modal-back" onClick={() => setModal(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>用 Tox ID 加好友</h3>
                <input
                  className="search"
                  style={{ width: '100%', margin: '12px 0' }}
                  value={toxInput}
                  onChange={(e) => setToxInput(e.target.value)}
                  placeholder="76 位 Tox ID"
                />
                <div className="btn-row">
                  <button className="teal-btn" onClick={() => { addFriend(); setModal(null) }} type="button">发送请求</button>
                  <button className="plain-btn" onClick={() => setModal(null)} type="button">取消</button>
                </div>
              </div>
            </div>
          ) : null}

          {call ? (
            <div className="call-overlay">
              <div className="call-card">
                <div className="avatar" style={{ background: call.friend?.color }}>{call.friend?.initials}</div>
                <h2>{call.friend?.name}</h2>
                <p className="meta" style={{ color: '#9aafbd' }}>{call.kind === 'video' ? '视频呼叫 · P2P' : '语音呼叫 · P2P'}</p>
                <div className="btn-row" style={{ justifyContent: 'center', marginTop: 18 }}>
                  <button className="danger-btn" onClick={() => { hooked('hangup', { friendId: activeId }); setCall(null) }} type="button">挂断</button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="toast-stack">
            {toasts.map((t) => (
              <div className="toast" key={t.id}>
                <b>{t.title}</b>
                {t.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function RailBtn({ icon, active, onClick, badge, label }) {
  return (
    <button className={`rail-btn ${active ? 'active' : ''}`} onClick={onClick} type="button" title={label} aria-label={label}>
      {icon}
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  )
}
