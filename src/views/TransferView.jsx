import { useRef, useState } from 'react'
import { IconSpark, IconTransfer } from '../icons.jsx'
import { goOffline, goOnline } from '../net/client.js'
import { accept, activeIds, buildPlan, cancel, concurrencyLimit, hasFile, pause, reattach, resume, startTransfer } from '../net/transfers.js'
import { setState, useApp } from '../net/store.js'
import { exactBytes, formatBytes, hashBlocks, shortHash } from '../lib/format.js'

const STATE_LABEL = { offered: '等待接收', accepted: '准备发送', sending: '传输中', interrupted: '可恢复', verifying: '校验中', done: '已完成', failed: '校验失败', canceled: '已取消' }
const STATE_CLASS = { offered: 'wait', accepted: 'wait', sending: 'run', interrupted: 'resume', verifying: 'run', done: 'done', failed: 'fail', canceled: 'wait' }
const LIMITS = [[0, '不限速'], [4096, '4 MB/s'], [1024, '1 MB/s'], [256, '256 KB/s'], [64, '64 KB/s']]

// 续传验证面板：数字全部来自服务端账本，不是前端自己算的“演示值”
function proofOf(t) {
  if (!t) return null
  const n = t.sessions.length
  const last = t.sessions.at(-1)
  if (n >= 2) {
    const A = last.startOffset
    const B = last.bytes
    return { A, B, resumed: true, sumOk: t.state === 'done' ? A + B === t.size : null }
  }
  if (t.state === 'interrupted') return { A: t.confirmed, B: null, resumed: false, sumOk: null }
  if (n === 1) return { A: 0, B: last.bytes, resumed: false, sumOk: t.state === 'done' ? last.bytes === t.size : null }
  return { A: null, B: null, resumed: false, sumOk: null }
}

export default function TransferView() {
  const { transfers, me, token, friends, policy, limitKBps, link, quality, rtt, rates, paused, hashing } = useApp()
  const [filter, setFilter] = useState('all')
  const [proofId, setProofId] = useState('')
  const pickRefs = useRef({})
  const all = Object.values(transfers).sort((a, b) => b.updatedAt - a.updatedAt)
  const focus = all.find((t) => t.id === proofId) || all.find((t) => t.state !== 'canceled')
  const groups = {
    all,
    active: all.filter((t) => ['accepted', 'sending', 'verifying'].includes(t.state)),
    pending: all.filter((t) => ['offered', 'interrupted', 'failed'].includes(t.state)),
    done: all.filter((t) => t.state === 'done'),
  }
  const shown = groups[filter]
  const proof = proofOf(focus)
  const act = activeIds()
  const limit = concurrencyLimit()
  const totalRate = Object.entries(rates).reduce((sum, [id, rate]) => sum + (transfers[id]?.state === 'sending' && !paused[id] ? rate : 0), 0)
  const name = (id) => friends.find((f) => f.id === id)?.username || '未知'

  const openPlan = () => setState({ plan: buildPlan(), modal: { type: 'plan' } })

  return (
    <div className="pane">
      <div className="pane-head">
        <div>
          <h2>文件传输</h2>
        </div>
        <div className="btn-row">
          <button className="plain-btn" type="button" onClick={openPlan}><IconSpark /> 智能方案</button>
          <button className="teal-btn" type="button" onClick={() => setState({ tab: 'chat' })}><IconTransfer /> 去会话发文件</button>
        </div>
      </div>

      <div className="scroll transfer-body">
        <div className="transfer-filters" aria-label="筛选传输任务">
          {[['all', '全部'], ['active', '进行中'], ['pending', '待处理'], ['done', '已完成']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}<span>{groups[id].length}</span></button>
          ))}
        </div>


        <div className="cards">
          {Object.values(hashing).map((h) => (
            <article className="t-card" key={h.name}><div><h4>{h.name}</h4><div className="meta">正在计算 SHA-256：{h.pct}%</div><div className="bar"><i style={{ width: `${h.pct}%` }} /></div></div></article>
          ))}
          {!shown.length && !Object.keys(hashing).length ? <div className="empty transfer-empty"><IconTransfer /><h3>{all.length ? '这个分类下没有任务' : '还没有传输任务'}</h3><p>{all.length ? '切换到“全部”查看其他文件。' : '在会话中选择文件，即可发送给好友。'}</p></div> : null}
          {shown.map((t) => {
            const pct = Math.round((t.confirmed / t.size) * 100)
            const sender = t.from === me.id
            const isPaused = paused[t.id] && t.state === 'sending'
            return (
              <article className="t-card" key={t.id}>
                <div>
                  <h4>
                    {t.name} <span className={`status ${STATE_CLASS[t.state]}`}>{isPaused ? '已暂停' : STATE_LABEL[t.state]}</span>
                  </h4>
                  <div className="meta">
                    {sender ? `发给 ${name(t.to)}` : `来自 ${name(t.from)}`} · {formatBytes(t.confirmed)} / {formatBytes(t.size)}
                    {t.state === 'sending' && rates[t.id] ? ` · ${formatBytes(Math.round(rates[t.id]))}/s` : ''}
                    {t.sessions.length > 1 ? ` · 已续传 ${t.sessions.length - 1} 次` : ''}
                  </div>
                  <div className="progress-row"><div className="bar" role="progressbar" aria-label={`${t.name} 传输进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div><span className="meta">{pct}%</span></div>
                  {t.reason ? <div className="meta" style={{ color: 'var(--danger)' }}>{t.reason}</div> : null}
                </div>
                <div className="btn-row" style={{ alignContent: 'start', justifyContent: 'end' }}>
                  {t.state === 'done' ? <a className="plain-btn small" href={`/api/files/${t.id}?token=${token}`} download={t.name}>下载文件</a> : null}
                  {t.state === 'offered' && !sender ? <button className="teal-btn small" type="button" onClick={() => accept(t.id)}>接收</button> : null}
                  {t.state === 'interrupted' && sender && link === 'online' ? (
                    hasFile(t.id) ? (
                      <button className="amber-btn small" type="button" onClick={() => startTransfer(t.id)}>续传</button>
                    ) : (
                      <>
                        <button className="amber-btn small" type="button" onClick={() => pickRefs.current[t.id]?.click()}>选择原文件续传</button>
                        <input ref={(el) => (pickRefs.current[t.id] = el)} type="file" hidden onChange={(e) => e.target.files[0] && reattach(t.id, e.target.files[0])} />
                      </>
                    )
                  ) : null}
                  {t.state === 'sending' && sender ? (
                    isPaused ? <button className="plain-btn small" type="button" onClick={() => resume(t.id)}>继续</button> : <button className="plain-btn small" type="button" onClick={() => pause(t.id)}>暂停</button>
                  ) : null}
                  {!['done', 'canceled', 'failed', 'verifying'].includes(t.state) ? <button className="plain-btn small" type="button" onClick={() => cancel(t.id)}>取消</button> : null}
                </div>
              </article>
            )
          })}
        </div>
        <details className="advanced-panel">
          <summary>续传验证与连接设置</summary>
          <div className="advanced-content">
          <div className="section-heading"><h3>续传验证</h3>
            {link === 'manual' || link === 'offline' ? <button className="teal-btn small" type="button" onClick={goOnline}>恢复连接</button> : <button className="plain-btn small" type="button" onClick={goOffline} disabled={link !== 'online'}>断开网络</button>}
          </div>
          {all.length ? <label className="field-label">核对文件<select className="field" value={focus?.id || ''} onChange={(e) => setProofId(e.target.value)}><option value="" disabled>选择文件</option>{all.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label> : null}
        <div className="hero-board">
          <div className="verify-steps">
            <span>验证方式</span>
            <ol>
              <li>在聊天里给好友发一个较大的文件，对方点“接收”；把下面的限速调到 1 MB/s 左右。</li>
              <li>传到约一半时点「断开网络」，记下此时已确认的偏移 A。</li>
              <li>点「恢复连接」，在弹出的窗口里确认续传，只发送剩下的 B。</li>
              <li>核对 A + B 等于文件大小，并且发送端与接收端的 SHA-256 一致。</li>
            </ol>
          </div>
          {!focus ? <p className="meta">发送文件后，这里会显示实际传输与校验结果。</p> : null}
          <div className="proof">
            <div className="proof-card"><em>已传 A（中断时）</em><b>{proof?.A != null ? exactBytes(proof.A) : '—'}</b></div>
            <div className="proof-card"><em>{proof?.resumed ? '续传 B' : '本次已传'}</em><b>{proof?.B != null ? exactBytes(proof.B) : '—'}</b></div>
            <div className={`proof-card ${proof?.sumOk ? 'ok' : ''}`}>
              <em>文件大小{proof?.sumOk ? (proof.resumed ? ' · A + B 相等' : ' · 字节数一致') : ''}</em>
              <b>{focus ? exactBytes(focus.size) : '—'}</b>
            </div>
            <div className={`proof-card ${focus?.hashOk === true ? 'ok' : focus?.hashOk === false ? 'bad' : ''}`}>
              <em>SHA-256</em>
              <b>{focus?.hashOk === true ? '一致' : focus?.hashOk === false ? '不一致' : '未完成'}</b>
            </div>
          </div>
          {focus ? (
            <div className="hash-compare">
              <div className="hash-row"><span className="meta">发送端</span><div className="blocks">{hashBlocks(focus.sha256).map((c, i) => <i key={i} style={{ background: c }} />)}</div><span className="mono">{shortHash(focus.sha256)}</span></div>
              <div className="hash-row"><span className="meta">接收端</span>
                {focus.receivedSha256 ? <><div className="blocks">{hashBlocks(focus.receivedSha256).map((c, i) => <i key={i} style={{ background: c }} />)}</div><span className="mono">{shortHash(focus.receivedSha256)}</span></> : <span className="mono">等待校验</span>}
              </div>
            </div>
          ) : null}
        </div>

        <div className="scheduler">
          <div>
            <div className="sub" style={{ marginBottom: 8 }}>调度策略 · 正在发送 {act.length} / 最多 {limit} 路</div>
            <div className="seg">
              {[['speed', '速度优先'], ['fair', '公平优先'], ['save', '省电优先']].map(([id, label]) => (
                <button key={id} className={policy === id ? 'on' : ''} type="button" aria-pressed={policy === id} onClick={() => setState({ policy: id })}>{label}</button>
              ))}
            </div>
            <div className="sub" style={{ margin: '10px 0 6px' }}>发送限速</div>
            <div className="seg">
              {LIMITS.map(([v, label]) => (
                <button key={v} className={limitKBps === v ? 'on' : ''} type="button" aria-pressed={limitKBps === v} onClick={() => setState({ limitKBps: v })}>{label}</button>
              ))}
            </div>
          </div>
          <div className="kv">
            <span>连接 <b>{link === 'online' ? '在线' : link === 'manual' ? '已手动断开' : link === 'connecting' ? '连接中' : '已断开'}</b></span>
            <span>链路质量 <b>{quality}</b></span>
            <span>RTT <b>{rtt != null ? `${rtt} ms` : '—'}</b></span>
            <span>吞吐 <b>{formatBytes(Math.round(totalRate))}/s</b></span>
          </div>
        </div>
          </div>
        </details>
      </div>
    </div>
  )
}
