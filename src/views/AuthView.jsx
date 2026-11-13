import { useState } from 'react'
import { login, register } from '../net/client.js'
import { IconChat, IconTransfer, IconVideo } from '../icons.jsx'

export default function AuthView() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
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
    <main className="gate">
      <section className="gate-left">
        <div className="brand-row"><span className="brand-mark" /><strong>ReliaTox</strong></div>
        <div className="gate-intro">
          <h1>对话继续。<br />文件也从断点继续。</h1>
          <p>把聊天、文件传输和视频会议放在一起，让沟通更简单。</p>
          <ul className="feature-list">
            <li><IconChat /><div><b>即时聊天</b><span>离线消息保留，上线后继续对话。</span></div></li>
            <li><IconTransfer /><div><b>可靠传输</b><span>中断后接着传，完成后校验文件完整性。</span></div></li>
            <li><IconVideo /><div><b>视频会议</b><span>邀请好友入会，分享画面与想法。</span></div></li>
          </ul>
        </div>
      </section>
      <section className="gate-right" aria-label="账号登录与注册">
        <form className="auth-card" onSubmit={submit} aria-busy={busy}>
          <div><h2>{mode === 'login' ? '欢迎回来' : '创建账号'}</h2><p className="meta">{mode === 'login' ? '登录后，继续你的会话。' : '用一个用户名，开始连接。'}</p></div>
          <div className="seg auth-tabs" aria-label="账号操作">
            <button type="button" aria-pressed={mode === 'login'} disabled={busy} className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError('') }}>登录</button>
            <button type="button" aria-pressed={mode === 'register'} disabled={busy} className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setError('') }}>注册</button>
          </div>
          <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required maxLength={20} placeholder="输入用户名" disabled={busy} /></label>
          {mode === 'register' ? <p className="field-help">2–20 个字符，支持中英文、数字、下划线和短横线。</p> : null}
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 6 : undefined} placeholder={mode === 'register' ? '设置密码，至少 6 位' : '输入密码'} disabled={busy} /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="teal-btn" type="submit" disabled={busy || !username.trim() || !password}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号并登录'}</button>
          <p className="auth-note">好友可以通过用户名找到你。</p>
        </form>
      </section>
    </main>
  )
}
