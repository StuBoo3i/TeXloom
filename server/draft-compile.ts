function argument(source: string, from: number): string | null {
  if (source[from] !== '{') return null
  let depth = 0
  for (let i = from; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(from, i + 1)
  }
  return null
}

export function draftSource(source: string, file: string, included: ReadonlySet<string>): { source: string; skipped: number } {
  const opening = /^[ \t]*\\begin\{(figure\*?|table\*?)\}(\[[^\]]*\])?/gm
  const edits: { start: number; end: number; replacement: string }[] = []
  const environments: { start: number; end: number }[] = []
  let match: RegExpExecArray | null
  while ((match = opening.exec(source))) {
    const endCommand = `\\end{${match[1]}}`
    const closeAt = source.indexOf(endCommand, opening.lastIndex)
    if (closeAt < 0) continue
    const end = closeAt + endCommand.length
    environments.push({ start: match.index, end })
    const raw = source.slice(match.index, end)
    const labelValue = /\\label\{([^{}]+)\}/.exec(raw)?.[1]
    if (included.has(`${file}:offset:${match.index}`) || labelValue && included.has(`${file}:label:${labelValue}`)) { opening.lastIndex = end; continue }
    const captionMatch = /\\caption(?:\[[^\]]*\])?\s*\{/.exec(raw)
    const caption = captionMatch ? argument(raw, captionMatch.index + captionMatch[0].length - 1) : null
    if (captionMatch && !caption) { opening.lastIndex = end; continue }
    const labels = [...raw.matchAll(/\\label\{([^{}]+)\}/g)].map(item => item[0]).join('')
    if (labels && !caption) { opening.lastIndex = end; continue }
    const kind = match[1].startsWith('figure') ? 'figure' : 'table'
    const placeholder = `${match[0]}\\centering\\fbox{\\parbox{.75\\linewidth}{\\centering Draft ${kind} placeholder}}${caption ? `\\caption${caption.replace(/\r?\n/g, ' ')}` : ''}${labels}${endCommand}`
    edits.push({ start: match.index, end, replacement: placeholder + '\n'.repeat((raw.match(/\n/g) ?? []).length) })
    opening.lastIndex = end
  }
  const image = /^[ \t]*\\includegraphics(?:\[[^\]]*\])?\s*\{[^{}]+\}/gm
  while ((match = image.exec(source))) {
    if (environments.some(entry => match!.index >= entry.start && match!.index < entry.end)) continue
    if (included.has(`${file}:offset:${match.index}`)) continue
    edits.push({ start: match.index, end: match.index + match[0].length, replacement: '\\fbox{Draft image placeholder}' })
  }
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  return { source: result, skipped: edits.length }
}
