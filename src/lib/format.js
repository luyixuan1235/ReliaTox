export function formatBytes(n) {
  if (n == null) return '—'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

// 验证面板里用精确字节数：A + B = 文件大小 必须能心算核对
export const exactBytes = (n) => (n == null ? '—' : `${n.toLocaleString('en-US')} B`)

export function shortHash(hash) {
  if (!hash) return '—'
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`
}

export function hashBlocks(hash) {
  const src = (hash || '00000000').replace(/[^0-9a-f]/gi, '').padEnd(16, '0')
  return Array.from({ length: 8 }, (_, i) => {
    const n = Number.parseInt(src.slice(i * 2, i * 2 + 2), 16)
    return `hsl(${(n * 1.4 + i * 28) % 360} 42% 46%)`
  })
}

const PALETTE = ['#0f8f82', '#c9792a', '#5b6fb5', '#a8527a', '#6c8a2f', '#8a5a9e', '#b5533c']
export function avatarColor(seed = '') {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
export const initials = (name = '?') => [...name][0]?.toUpperCase() || '?'

export function clock(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
