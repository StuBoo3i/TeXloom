export type AgentHunk = { index: number; beforeStart: number; beforeEnd: number; afterStart: number; afterEnd: number; before: string; after: string }

function lines(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

export function lineHunks(before: string, after: string): AgentHunk[] | null {
  if (before.length + after.length > 2 * 1024 * 1024) return null
  const a = lines(before), b = lines(after)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix
  if (n > 1500 || m > 1500) return null
  const width = m + 1
  const dp = new Uint16Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i * width + j] = a[prefix + i] === b[prefix + j]
      ? dp[(i + 1) * width + j + 1] + 1
      : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
  }
  const hunks: AgentHunk[] = []
  let i = 0, j = 0
  let startI = -1, startJ = -1
  const flush = () => {
    if (startI < 0) return
    hunks.push({ index: hunks.length, beforeStart: prefix + startI, beforeEnd: prefix + i, afterStart: prefix + startJ, afterEnd: prefix + j, before: a.slice(prefix + startI, prefix + i).join(''), after: b.slice(prefix + startJ, prefix + j).join('') })
    startI = -1; startJ = -1
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[prefix + i] === b[prefix + j]) { flush(); i++; j++; continue }
    if (startI < 0) { startI = i; startJ = j }
    if (j >= m || i < n && dp[(i + 1) * width + j] >= dp[i * width + j + 1]) i++
    else j++
  }
  flush()
  return hunks.length <= 100 ? hunks : null
}

export function applyLineHunks(before: string, hunks: AgentHunk[], selected: ReadonlySet<number>): string {
  const original = lines(before)
  const output: string[] = []
  let cursor = 0
  for (const hunk of hunks) {
    output.push(...original.slice(cursor, hunk.beforeStart))
    output.push(selected.has(hunk.index) ? hunk.after : hunk.before)
    cursor = hunk.beforeEnd
  }
  output.push(...original.slice(cursor))
  return output.join('')
}
