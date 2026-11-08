export function formatBytes(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function shortHash(hash) {
  if (!hash) return '—'
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`
}

export function hashBlocks(hash) {
  const src = (hash || '00000000').replace(/[^0-9a-f]/gi, '').padEnd(16, '0')
  return Array.from({ length: 8 }, (_, i) => {
    const slice = src.slice(i * 2, i * 2 + 2)
    const n = Number.parseInt(slice, 16)
    const hue = (n * 1.4 + i * 28) % 360
    return `hsl(${hue} 42% 46%)`
  })
}
