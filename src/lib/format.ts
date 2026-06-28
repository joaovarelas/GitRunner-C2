// Human-readable byte size, e.g. 1536 -> "1.5 KB". Empty string for negative/invalid values.
export function fmtBytes(n: number | string): string {
  const v0 = typeof n === 'number' ? n : Number(n)
  if (isNaN(v0) || v0 < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = v0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`
}
