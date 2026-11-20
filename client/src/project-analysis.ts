export type OutlineEntry = { file: string; line: number; level: number; title: string }
export type SearchOptions = { query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export type SearchHit = { file: string; line: number; column: number; match: string; preview: string }

const textExtensions = /\.(tex|bib|sty|cls|txt|md|csv|tikz)$/i
export function isSearchableFile(path: string): boolean { return textExtensions.test(path) }

export function buildOutline(sources: Map<string, string>, mainFile: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  const visited = new Set<string>()
  const levels: Record<string, number> = { section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 }
  function visit(file: string) {
    if (visited.has(file)) return
    visited.add(file)
    const source = sources.get(file)
    if (!source) return
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      const uncommented = line.replace(/(^|[^\\])%.*/, '$1')
      for (const match of uncommented.matchAll(/\\(section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{([^{}]+)\}/g)) entries.push({ file, line: index + 1, level: levels[match[1]], title: match[2] })
      for (const match of uncommented.matchAll(/\\(?:input|include)\{([^{}]+)\}/g)) {
        const name = match[1].endsWith('.tex') ? match[1] : `${match[1]}.tex`
        const base = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''
        const candidate = `${base}${name}`
        visit(sources.has(candidate) ? candidate : name)
      }
    }
  }
  visit(mainFile)
  return entries
}

export function searchPattern(options: SearchOptions): RegExp {
  const raw = options.query.trim()
  if (!raw || raw.length > 200) throw new Error('搜索内容须为 1 至 200 个字符')
  const expression = options.regex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${expression})(?![\\p{L}\\p{N}_])` : expression
  return new RegExp(source, `g${options.caseSensitive ? '' : 'i'}u`)
}

export function searchSources(sources: Map<string, string>, options: SearchOptions, limit = 500): SearchHit[] {
  const pattern = searchPattern(options)
  const results: SearchHit[] = []
  for (const [file, source] of sources) {
    if (!isSearchableFile(file)) continue
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(line))) {
        results.push({ file, line: index + 1, column: match.index + 1, match: match[0], preview: line.trim().slice(0, 180) })
        if (results.length >= limit) return results
        if (!match[0]) pattern.lastIndex++
      }
    }
  }
  return results
}

export function replaceSource(source: string, options: SearchOptions, replacement: string): { content: string; count: number } {
  let count = 0
  const content = source.replace(searchPattern(options), () => { count++; return replacement })
  return { content, count }
}
