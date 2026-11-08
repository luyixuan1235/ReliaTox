import { formatBytes, hashBlocks, shortHash } from '../lib/format.js'
import { FILE_SIZE, OFFSET_A, REMAIN_B } from '../data.js'
import { IconSpark } from '../icons.jsx'

const STATUS = {
  wait: '等待对方',
  run: '传输中',
  resume: '可恢复',
  fail: '校验失败',
  done: '已完成',
}

export default function TransferView({
  jobs,
  policy,
  setPolicy,
  link,
  quality,
  onResume,
  onAiPlan,
  onDisconnect,
  onReconnect,
  proof,
}) {
  const running = jobs.filter((j) => j.status === 'run').length
  const limit = quality === '差' ? 2 : policy === 'save' ? 2 : policy === 'fair' ? 3 : 4

  return (
    <div className="pane">
      <div className="pane-head">
        <div>
          <h2>传输账本</h2>
          <div className="sub">进度写在两边本地 · 无中心服务器 · 续传认 32 字节 file_id</div>
        </div>
        <div className="btn-row">
          <button className="plain-btn" onClick={onAiPlan} type="button">
            AI 传输方案
          </button>
          {link === 'offline' ? (
            <button className="teal-btn" onClick={onReconnect} type="button">恢复连接</button>
          ) : (
            <button className="dark-btn" onClick={onDisconnect} type="button">模拟断线</button>
          )}
        </div>
      </div>

      <div className="hero-board">
        <h3>续传验证</h3>
        <div className="verify-steps">
          <span>验证方式</span>
          <ol>
            <li>传到约一半时断开连接，记下已确认偏移 A。</li>
            <li>重新连接后确认续传，本地 seek 到 A 再发起。</li>
            <li>记录续传阶段实际发送量 B，核对 A + B 等于文件大小。</li>
            <li>接收端写临时文件，SHA-256 校验通过后才改成正式文件名。</li>
          </ol>
        </div>
        <div className="proof">
          <div className="proof-card">
            <em>已传 A</em>
            <b>{proof ? formatBytes(proof.a) : formatBytes(OFFSET_A)}</b>
          </div>
          <div className="proof-card">
            <em>本次续传 B</em>
            <b>{proof ? formatBytes(proof.b) : '待确认'}</b>
          </div>
          <div className="proof-card">
            <em>文件大小</em>
            <b>{formatBytes(FILE_SIZE)}</b>
          </div>
          <div className={`proof-card ${proof?.match ? 'ok' : ''}`}>
            <em>SHA-256</em>
            <b>{proof?.match ? '一致' : '未完成'}</b>
          </div>
        </div>
      </div>

      <div className="scheduler">
        <div>
          <div className="sub" style={{ marginBottom: 8 }}>调度策略 · 当前并发 {Math.min(running, limit)} / {limit} 路</div>
          <div className="seg">
            {[
              ['speed', '速度优先'],
              ['fair', '公平优先'],
              ['save', '省电优先'],
            ].map(([id, label]) => (
              <button key={id} className={policy === id ? 'on' : ''} onClick={() => setPolicy(id)} type="button">
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="kv">
          <span>链路 <b>{link === 'udp' ? 'UDP 直连' : link === 'relay' ? 'TCP Relay' : '已断开'}</b></span>
          <span>质量 <b>{quality}</b></span>
          <span>RTT <b>{link === 'offline' ? '—' : quality === '差' ? '186 ms' : '38 ms'}</b></span>
          <span>速率 <b>{link === 'offline' ? '0' : quality === '差' ? '1.1' : '12.4'} MB/s</b></span>
        </div>
      </div>

      <div className="cards scroll">
        {jobs.map((job) => {
          const pct = Math.round((job.confirmed / job.size) * 100)
          return (
            <article className="t-card" key={job.id}>
              <div>
                <h4>
                  {job.name}{' '}
                  <span className={`status ${job.status}`}>{STATUS[job.status]}</span>
                </h4>
                <div className="meta">
                  {job.direction} · {job.peer} · {formatBytes(job.confirmed)} / {formatBytes(job.size)}
                </div>
                <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="mono">file_id {shortHash(job.fileId)}</div>
                {job.hash ? (
                  <div className="hash-row">
                    <div className="blocks">
                      {hashBlocks(job.hash).map((c, i) => <i key={i} style={{ background: c }} />)}
                    </div>
                    <span className="mono">{shortHash(job.hash)}</span>
                  </div>
                ) : null}
                <div className="meta" style={{ marginTop: 6 }}>{job.note}</div>
              </div>
              <div className="btn-row" style={{ alignContent: 'start', justifyContent: 'end' }}>
                {job.status === 'resume' ? (
                  <button className="amber-btn" onClick={() => onResume(job)} type="button">续传</button>
                ) : null}
                {job.id === 'demo' ? (
                  <button className="plain-btn" onClick={onAiPlan} type="button">
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <IconSpark /> 方案
                    </span>
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
