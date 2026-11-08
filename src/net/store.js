import { useSyncExternalStore } from 'react'

const TOKEN_KEY = 'reliatox.token'
// 用 sessionStorage：同一个浏览器里每个标签页是一个独立登录，方便一个人开两个窗口演示。
export const loadToken = () => sessionStorage.getItem(TOKEN_KEY)
export const saveToken = (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY))

let state = {
  boot: true, // 正在检查登录态
  me: null,
  token: loadToken(),
  link: 'idle', // idle | connecting | online | offline | manual
  rtt: null,
  quality: '—',
  iceServers: [],
  tab: 'chat',
  friends: [],
  activeId: null,
  messages: {},
  unread: {},
  transfers: {},
  rates: {},
  hashing: {},
  policy: 'fair',
  limitKBps: 0,
  paused: {},
  priority: [],
  resumePrompt: null,
  plan: null,
  modal: null,
  toasts: [],
  events: [],
  meet: null,
  invite: null,
}

const subs = new Set()
export const getState = () => state
export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch
  if (!next) return
  state = { ...state, ...next }
  subs.forEach((f) => f())
}
const subscribe = (f) => {
  subs.add(f)
  return () => subs.delete(f)
}
export const useApp = () => useSyncExternalStore(subscribe, getState)

export function toast(title, text = '') {
  const id = Math.random().toString(36).slice(2)
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, title, text }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3600)
}

export function log(kind, text) {
  setState((s) => ({ events: [{ id: Math.random().toString(36).slice(2), at: Date.now(), kind, text }, ...s.events].slice(0, 80) }))
}
