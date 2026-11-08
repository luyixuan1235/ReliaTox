import { useRef } from 'react'
import { IconSpark } from '../icons.jsx'
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
  if (n === 1) return { A: null, B: last.bytes, resumed: false, sumOk: t.state === 'done' ? last.bytes === t.size : null }
  return { A: null, B: null, resumed: false, sumOk: null }
}

export default function TransferView() {
  const { transfers, me, friends, policy, limitKBps, link, quality, rtt, rates, paused, hashing } = useApp()
  const pickRefs = useRef({})
  const all = Object.values(transfers).sort((a, b) => b.updatedAt - a.updatedAt)
  const focus = all.find((t) => t.state !== 'canceled')
  const proof = proofOf(focus)
  const act = activeIds()
  const limit = concurrencyLimit()
  const totalRate = Object.values(rates).reduce((a, b) => a + b, 0)
  const name = (id) => friends.find((f) => f.id === id)?.username || '未知'

  const openPlan = () => setState({ plan: buildPlan(), modal: { type: 'plan' } })

  return (
    <div className="pane">
      <div className="pane-head">
        <div>
          <h2>传输</h2>
          <div className="sub">进度记在服务端账本里 · 续传认 32 字节 file id · 收完后校验 SHA-256</div>
        </div>
        <div className="btn-row">
          <button className="plain-btn" type="button" onClick={openPlan}><IconSpark /> 智能方案</button>
          {link === 'manual' || link === 'offline' ? (
            <button className="teal-btn" type="button" onClick={goOnline}>恢复连接</button>
          ) : (
            <button className="dark-btn" type="button" onClick={goOffline} disabled={link !== 'online'}>断开网络</button>
          )}
        </div>
      </div>

      <div className="scroll">
        <div className="hero-board">
          <h3>续传验证</h3>
          <div className="verify-steps">
            <span>验证方式</span>
            <ol>
              <li>在聊天里给好友发一个较大的文件，对方点“接收”；把下面的限速调到 1 MB/s 左右。</li>
              <li>传到约一半时点「断开网络」，记下此时已确认的偏移 A。</li>
              <li>点「恢复连接」，在弹出的窗口里确认续传，只发送剩下的 B。</li>
              <li>核对 A + B 等于文件大小，并且发送端与接收端的 SHA-256 一致。</li>
            </ol>
          </div>
          {focus ? <div className="meta" style={{ color: '#b9c6d0', marginTop: 10 }}>当前核对的文件：{focus.name}</div> : <div className="meta" style={{ color: '#b9c6d0', marginTop: 10 }}>还没有传输。发一个文件之后，这里会实时显示数字。</div>}
          <div className="proof">
            <div className="proof-card"><em>已传 A（中断时）</em><b>{proof?.A != null ? exactBytes(proof.A) : '—'}</b></div>
            <div className="proof-card"><em>续传 B</em><b>{proof?.B != null ? exactBytes(proof.B) : '—'}</b></div>
            <div className={`proof-card ${proof?.sumOk ? 'ok' : ''}`}>
              <em>文件大小{proof?.sumOk ? ' · A + B 相等' : ''}</em>
              <b>{focus ? exactBytes(focus.size) : '—'}</b>
            </div>
            <div className={`proof-card ${focus?.hashOk === true ? 'ok' : focus?.hashOk === false ? 'bad' : ''}`}>
              <em>SHA-256</em>
              <b>{focus?.hashOk === true ? '一致' : focus?.hashOk === false ? '不一致' : '未完成'}</b>
            </div>
          </div>
          {focus ? (
            <div className="hash-compare">
              <div className="hash-row"><span className="meta" style={{ width: 54, color: '#b9c6d0' }}>发送端</span><div className="blocks">{hashBlocks(focus.sha256).map((c, i) => <i key={i} style={{ background: c }} />)}</div><span className="mono">{shortHash(focus.sha256)}</span></div>
              <div className="hash-row"><span className="meta" style={{ width: 54, color: '#b9c6d0' }}>接收端</span>
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
                <button key={id} className={policy === id ? 'on' : ''} type="button" onClick={() => setState({ policy: id })}>{label}</button>
              ))}
            </div>
            <div className="sub" style={{ margin: '10px 0 6px' }}>发送限速（用来把传输拖慢，方便观察中断和续传）</div>
            <div className="seg">
              {LIMITS.map(([v, label]) => (
                <button key={v} className={limitKBps === v ? 'on' : ''} type="button" onClick={() => setState({ limitKBps: v })}>{label}</button>
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

        <div className="cards">
          {Object.values(hashing).map((h) => (
            <article className="t-card" key={h.name}><div><h4>{h.name}</h4><div className="meta">正在计算 SHA-256：{h.pct}%</div><div className="bar"><i style={{ width: `${h.pct}%` }} /></div></div></article>
          ))}
          {!all.length && !Object.keys(hashing).length ? <div className="empty small">还没有传输任务</div> : null}
          {all.map((t) => {
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
                  <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                  <div className="mono">file id {shortHash(t.id)}</div>
                  {t.reason ? <div className="meta" style={{ color: 'var(--danger)' }}>{t.reason}</div> : null}
                </div>
                <div className="btn-row" style={{ alignContent: 'start', justifyContent: 'end' }}>
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
      </div>
    </div>
  )
}
