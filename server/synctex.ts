import path from 'node:path'

export type SyncPoint = { file: string; line: number; page: number; x: number; y: number; kind: 'text' | 'box' }

/** Convert the compact SyncTeX output to safe, project-relative source anchors. */
export function parseSynctex(source: string, projectDirectory: string): SyncPoint[] {
  const inputs = new Map<number, string>()
  const root = path.resolve(projectDirectory)
  let unit = 1
  let magnification = 1000
  let xOffset = 0
  let yOffset = 0
  let page = 0
  let inContent = false
  const points: SyncPoint[] = []
  const seen = new Set<string>()
  for (const row of source.split(/\r?\n/)) {
    const input = /^Input:(\d+):(.+)$/.exec(row)
    if (input) {
      const absolute = path.resolve(root, input[2])
      const relative = path.relative(root, absolute)
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) inputs.set(Number(input[1]), relative.split(path.sep).join('/'))
      continue
    }
    if (!inContent) {
      if (row.startsWith('Unit:')) unit = Number(row.slice(5)) || 1
      if (row.startsWith('Magnification:')) magnification = Number(row.slice(14)) || 1000
      if (row.startsWith('X Offset:')) xOffset = Number(row.slice(9)) || 0
      if (row.startsWith('Y Offset:')) yOffset = Number(row.slice(9)) || 0
      if (row === 'Content:') inContent = true
      continue
    }
    if (row === 'Postamble:') break
    const pageStart = /^\{(\d+)$/.exec(row)
    if (pageStart) { page = Number(pageStart[1]); continue }
    // h boxes are the text-line anchors emitted by Tectonic. Parenthesized
    // boxes cover displays and figures which may have no h box.
    const match = /^[h(](\d+),(\d+):(-?\d+),(-?\d+)/.exec(row)
    if (!match || !page) continue
    const file = inputs.get(Number(match[1]))
    const line = Number(match[2])
    if (!file || !line) continue
    const scale = unit * 1000 / magnification / 65536
    const x = (Number(match[3]) + xOffset) * scale
    const y = (Number(match[4]) + yOffset) * scale
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const key = `${file}:${line}:${page}:${Math.round(y)}`
    if (seen.has(key)) continue
    seen.add(key)
    points.push({ file, line, page, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, kind: row[0] === 'h' ? 'text' : 'box' })
    if (points.length >= 100_000) break
  }
  return points
}
