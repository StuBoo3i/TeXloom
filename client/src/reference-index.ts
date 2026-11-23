export type ReferenceKind = 'figure' | 'table' | 'equation' | 'section' | 'other'
type ReferenceLocation = { value: string; file: string; offset: number; title: string }
export type ReferenceItem = ReferenceLocation & { kind: ReferenceKind }
export type CitationItem = ReferenceLocation & { source: 'bib' | 'thebibliography'; detail: string }
export type ReferenceIndex = { references: ReferenceItem[]; citations: CitationItem[] }
export type IndexedSource = { file: string; source: string }

function maskComments(source: string): string {
  const chars = source.split('')
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '%' || i > 0 && chars[i - 1] === '\\') continue
    while (i < chars.length && chars[i] !== '\n') { chars[i] = ' '; i++ }
  }
  return chars.join('')
}

function group(source: string, opening: number): { start: number; end: number } | null {
  if (source[opening] !== '{') return null
  let depth = 0
  for (let i = opening; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return { start: opening + 1, end: i }
  }
  return null
}

function readable(source: string): string {
  return source.replace(/\\(?:textbf|textit|emph|texttt|mathrm|textsc)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?/g, '')
    .replace(/[{}~\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
}

function environments(source: string): { name: string; start: number; end: number }[] {
  const stack: { name: string; start: number }[] = []
  const result: { name: string; start: number; end: number }[] = []
  for (const match of source.matchAll(/\\(begin|end)\s*\{([^{}]+)\}/g)) {
    if (match[1] === 'begin') stack.push({ name: match[2], start: match.index })
    else {
      const at = stack.map(item => item.name).lastIndexOf(match[2])
      if (at >= 0) {
        const [item] = stack.splice(at)
        result.push({ ...item, end: match.index + match[0].length })
      }
    }
  }
  return result
}

function bibField(source: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*`, 'i').exec(source)
  if (!match) return ''
  const at = match.index + match[0].length
  if (source[at] === '{') {
    const value = group(source, at)
    return value ? readable(source.slice(value.start, value.end)) : ''
  }
  if (source[at] === '"') return readable(source.slice(at + 1, source.indexOf('"', at + 1) < 0 ? undefined : source.indexOf('"', at + 1)))
  return readable(source.slice(at).match(/^[^,\r\n}]+/)?.[0] ?? '')
}

function bibEntries(file: string, source: string): CitationItem[] {
  const masked = maskComments(source)
  const entries: CitationItem[] = []
  const pattern = /@([A-Za-z]+)\s*([({])/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(masked))) {
    const bodyStart = match.index + match[0].length
    const closing = match[2] === '{' ? '}' : ')'
    let depth = 1; let end = bodyStart
    for (; end < masked.length && depth; end++) {
      if (masked[end] === '{' || masked[end] === '(' && closing === ')') depth++
      if (masked[end] === '}' || masked[end] === ')' && closing === ')') depth--
    }
    if (depth) continue
    pattern.lastIndex = end
    if (/^(comment|string|preamble)$/i.test(match[1])) continue
    const header = /^\s*([^,\s{}()]+)\s*,/.exec(masked.slice(bodyStart, end - 1))
    if (!header) continue
    const body = source.slice(bodyStart + header[0].length, end - 1)
    const title = bibField(body, 'title')
    const author = bibField(body, 'author')
    const year = bibField(body, 'year')
    entries.push({ value: header[1], file, offset: match.index, source: 'bib', title: title || header[1], detail: [author, year].filter(Boolean).join(' · ') })
  }
  return entries
}

function texEntries(file: string, source: string): ReferenceIndex {
  const masked = maskComments(source).replace(/\\begin\{(verbatim|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g, match => match.replace(/[^\r\n]/g, ' '))
  const envs = environments(masked)
  const headings = [...masked.matchAll(/\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\s*\{/g)].map(match => {
    const title = group(masked, match.index + match[0].length - 1)
    return title ? { start: match.index, end: title.end + 1, title: readable(source.slice(title.start, title.end)) } : null
  }).filter(item => item !== null)
  const references: ReferenceItem[] = []
  for (const match of masked.matchAll(/\\label\s*\{([^{}]+)\}/g)) {
    const value = match[1].trim()
    if (!value) continue
    const enclosing = envs.filter(env => env.start < match.index && env.end > match.index).sort((a, b) => b.start - a.start)
    const named = enclosing.find(env => /^(figure\*?|table\*?|longtable|equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)$/.test(env.name))
    const name = named?.name ?? ''
    let kind: ReferenceKind = /^figure/.test(name) ? 'figure' : /^(table|longtable)/.test(name) ? 'table' : /^(equation|align|gather|multline|eqnarray)/.test(name) ? 'equation' : 'other'
    const heading = [...headings].reverse().find(item => item.end <= match.index)
    const attachedHeading = kind === 'other' && heading && /^\s*$/.test(masked.slice(heading.end, match.index)) ? heading : undefined
    if (attachedHeading) kind = 'section'
    if (kind === 'other') kind = /^(fig|figure)[:._-]/i.test(value) ? 'figure' : /^(tab|table)[:._-]/i.test(value) ? 'table' : /^(eq|equation)[:._-]/i.test(value) ? 'equation' : /^(sec|section|chap)[:._-]/i.test(value) ? 'section' : 'other'
    let title = ''
    if (named && (kind === 'figure' || kind === 'table')) {
      const segment = masked.slice(named.start, named.end)
      const caption = /\\caption(?:\[[^\]]*\])?\s*\{/.exec(segment)
      if (caption) {
        const value = group(masked, named.start + caption.index + caption[0].length - 1)
        if (value) title = readable(source.slice(value.start, value.end))
      }
    }
    if (kind === 'section') title ||= heading?.title ?? ''
    if (kind === 'equation' && named) title = readable(source.slice(named.start, named.end).replace(/\\label\s*\{[^{}]+\}/g, '')).slice(0, 100)
    references.push({ value, file, offset: attachedHeading?.start ?? match.index, kind, title })
  }
  const citations: CitationItem[] = []
  for (const env of envs.filter(item => item.name === 'thebibliography')) {
    const items = [...masked.slice(env.start, env.end).matchAll(/\\bibitem(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const start = env.start + item.index + item[0].length
      const end = i + 1 < items.length ? env.start + items[i + 1].index : env.end - '\\end{thebibliography}'.length
      const title = readable(source.slice(start, end))
      citations.push({ value: item[1].trim(), file, offset: env.start + item.index, source: 'thebibliography', title: title || item[1].trim(), detail: '文内参考文献' })
    }
  }
  return { references, citations }
}

export function buildReferenceIndex(sources: IndexedSource[]): ReferenceIndex {
  const references: ReferenceItem[] = []; const citations: CitationItem[] = []
  const seenReferences = new Set<string>(); const seenCitations = new Set<string>()
  for (const { file, source } of sources) {
    const index = /\.bib$/i.test(file) ? { references: [], citations: bibEntries(file, source) } : /\.tex$/i.test(file) ? texEntries(file, source) : { references: [], citations: [] }
    for (const item of index.references) if (!seenReferences.has(item.value)) { references.push(item); seenReferences.add(item.value) }
    for (const item of index.citations) if (item.value && !seenCitations.has(item.value)) { citations.push(item); seenCitations.add(item.value) }
  }
  return { references, citations }
}

export function referenceLatex(item: ReferenceItem | CitationItem): string {
  if ('source' in item) return `\\cite{${item.value}}`
  return item.kind === 'equation' ? `\\eqref{${item.value}}` : `\\ref{${item.value}}`
}
