import { useState } from 'react'
import { login, register } from '../net/client.js'

export default function AuthView() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await (mode === 'login' ? login : register)(username.trim(), password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-root">
      <section className="gate">
        <div className="gate-left">
          <div className="brand-row">
            <span className="brand-mark" />
            <strong>ReliaTox</strong>
          </div>
          <h1>续到断点。<br />不必重头再来。</h1>
          <p>聊天、传文件、视频会议都在一个窗口里。文件传到一半断了，重新连上后从已确认的位置继续，最后用 SHA-256 核对。</p>
          <ul className="feature-list">
            <li><i /> 断点续传：已传 A + 续传 B = 文件大小</li>
            <li><i /> 自适应调度：速度 / 公平 / 省电，按链路质量调并发</li>
            <li><i /> 新建会议、邀请好友，摄像头、麦克风、屏幕共享</li>
          </ul>
        </div>
        <div className="gate-right">
          <form className="auth-card" onSubmit={submit}>
            <div className="seg auth-tabs">
              <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError('') }}>登录</button>
              <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setError('') }}>注册</button>
            </div>
            <label>
              用户名
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus placeholder="2–20 个字符" />
            </label>
            <label>
              密码
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'register' ? '至少 6 位' : ''} />
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <button className="teal-btn" type="submit" disabled={busy || !username || !password}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号并登录'}
            </button>
            <p className="meta">
              {mode === 'login' ? '还没有账号？点上面的“注册”。' : '注册后会生成一个 76 位的 ID，好友可以用它或用户名加你。'}
            </p>
          </form>
        </div>
      </section>
    </div>
  )
}
