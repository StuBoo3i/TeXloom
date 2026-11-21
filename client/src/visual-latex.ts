export type SourceSpan = { start: number; end: number }
export type InlineNode = SourceSpan & {
  kind: 'text' | 'bold' | 'italic' | 'highlight' | 'math' | 'link' | 'reference' | 'citation' | 'source'
  raw: string
  value?: SourceSpan
  label?: SourceSpan
  target?: SourceSpan
  children?: InlineNode[]
  name?: string
}
export type VisualBlock = SourceSpan & {
  kind: 'paragraph' | 'heading' | 'list' | 'math' | 'source' | 'title' | 'abstract' | 'theorem' | 'highlight' | 'figure' | 'table' | 'blank'
  raw: string
  level?: number
  title?: SourceSpan
  items?: { span: SourceSpan; children: InlineNode[] }[]
  content?: SourceSpan
  children?: InlineNode[]
  summary?: string
  labels?: { span: SourceSpan; value: SourceSpan }[]
  name?: string
  body?: VisualBlock[]
  author?: SourceSpan
  date?: SourceSpan
  caption?: SourceSpan
  captionChildren?: InlineNode[]
  assets?: string[]
  rows?: string[][]
  tableCells?: { span: SourceSpan; children: InlineNode[] }[][]
}
export type VisualDocument = { source: string; blocks: VisualBlock[]; documentFound: boolean }

export function draftCardKey(file: string, block: VisualBlock, source: string): string {
  const label = block.labels?.[0]?.value
  return label ? `${file}:label:${source.slice(label.start, label.end)}` : `${file}:offset:${block.start}`
}

export function replaceSourceSpan(source: string, span: SourceSpan, expected: string, replacement: string): string {
  if (span.start < 0 || span.end > source.length || span.start > span.end || source.slice(span.start, span.end) !== expected) throw new Error('源码位置已变化，请重新选择片段')
  return source.slice(0, span.start) + replacement + source.slice(span.end)
}

export function decodeText(raw: string): string {
  return raw.replace(/\\([%$&#_{}])/g, '$1').replace(/~/g, '\u00a0')
}

export function encodeText(value: string): string {
  return value.replace(/\\/g, '\\textbackslash{}').replace(/[{}%$&#_~^\u00a0]/g, character => ({
    '{': '\\{', '}': '\\}', '%': '\\%', '$': '\\$', '&': '\\&', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '\u00a0': '~',
  })[character] ?? character)
}

export function sourceOffsetForVisible(raw: string, visibleOffset: number): number {
  let visible = 0
  for (let offset = 0; offset < raw.length; offset++) {
    if (visible >= visibleOffset) return offset
    if (raw[offset] === '\\' && /[%$&#_{}]/.test(raw[offset + 1] ?? '')) offset++
    else if (raw[offset] === '\r' && raw[offset + 1] === '\n') offset++
    visible++
  }
  return raw.length
}

export function visibleOffsetForSource(raw: string, sourceOffset: number): number {
  let visible = 0
  for (let offset = 0; offset < Math.min(sourceOffset, raw.length); offset++) {
    if (raw[offset] === '\\' && /[%$&#_{}]/.test(raw[offset + 1] ?? '')) offset++
    else if (raw[offset] === '\r' && raw[offset + 1] === '\n') offset++
    visible++
  }
  return visible
}

function group(source: string, start: number): SourceSpan | null {
  if (source[start] !== '{') return null
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\' && i + 1 < source.length) { i++; continue }
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return { start: start + 1, end: i }
  }
  return null
}

function commandEnd(source: string, start: number, limit: number): number {
  const name = source.slice(start).match(/^\\(?:[A-Za-z@]+\*?|.)/)?.[0] ?? '\\'
  let end = start + name.length
  while (end < limit && /[ \t]/.test(source[end])) end++
  for (let count = 0; count < 3 && end < limit; count++) {
    if (source[end] === '[') {
      const close = source.indexOf(']', end + 1)
      if (close < 0 || close >= limit) break
      end = close + 1
    } else if (source[end] === '{') {
      const found = group(source, end)
      if (!found || found.end >= limit) break
      end = found.end + 1
    } else break
  }
  return end
}

function inline(source: string, start: number, end: number): InlineNode[] {
  const result: InlineNode[] = []
  let textStart = start
  const flush = (at: number) => { if (at > textStart) result.push({ kind: 'text', start: textStart, end: at, raw: source.slice(textStart, at) }) }
  for (let i = start; i < end;) {
    if (source[i] === '%' && source[i - 1] !== '\\') { flush(i); const lineEnd = source.indexOf('\n', i); i = textStart = lineEnd < 0 || lineEnd >= end ? end : lineEnd + 1; continue }
    const delimiter = source.startsWith('\\(', i) ? '\\(' : source[i] === '$' && source[i - 1] !== '\\' ? '$' : ''
    if (delimiter) {
      const close = delimiter === '$' ? '$' : '\\)'
      const found = source.indexOf(close, i + delimiter.length)
      if (found >= 0 && found < end) {
        flush(i)
        const value = { start: i + delimiter.length, end: found }
        const next = found + close.length
        result.push({ kind: 'math', start: i, end: next, value, raw: source.slice(i, next) })
        i = textStart = next
        continue
      }
    }
    if (source[i] !== '\\') { i++; continue }
    if (i + 1 < end && /[%$&#_{}]/.test(source[i + 1])) { i += 2; continue }
    const name = source.slice(i, end).match(/^\\([A-Za-z@]+\*?)/)?.[1]
    if (!name) {
      if (source[i + 1] === '\\') { flush(i); const next = i + 2; result.push({ kind: 'source', start: i, end: next, raw: source.slice(i, next) }); i = textStart = next; continue }
      i += 2
      continue
    }
    const afterName = i + name.length + 1
    const first = group(source, afterName)
    const second = first && group(source, first.end + 1)
    if (name === 'label' && first && first.end < end) { flush(i); i = textStart = first.end + 1; continue }
    if (/^(kaishu|itshape|bfseries|normalfont|noindent)$/.test(name)) { flush(i); i = textStart = afterName; continue }
    let node: InlineNode | null = null
    if (first && first.end < end && /^(textbf|textit|emph)$/.test(name)) node = { kind: name === 'textbf' ? 'bold' : 'italic', start: i, end: first.end + 1, value: first, raw: source.slice(i, first.end + 1), children: inline(source, first.start, first.end) }
    else if (first && second && second.end < end && name === 'colorbox') node = { kind: 'highlight', name: source.slice(first.start, first.end), start: i, end: second.end + 1, value: second, raw: source.slice(i, second.end + 1), children: inline(source, second.start, second.end) }
    else if (first && second && second.end < end && name === 'href') node = { kind: 'link', start: i, end: second.end + 1, target: first, label: second, raw: source.slice(i, second.end + 1), children: inline(source, second.start, second.end) }
    else if (first && first.end < end && /^(ref|eqref|autoref|pageref|cref|Cref)$/.test(name)) node = { kind: 'reference', start: i, end: first.end + 1, value: first, raw: source.slice(i, first.end + 1) }
    else if (first && first.end < end && /^(cite|citep|citet|autocite|parencite)$/.test(name)) node = { kind: 'citation', start: i, end: first.end + 1, value: first, raw: source.slice(i, first.end + 1) }
    else if (first && first.end < end && name === 'url') node = { kind: 'link', start: i, end: first.end + 1, target: first, label: first, raw: source.slice(i, first.end + 1) }
    else { const next = commandEnd(source, i, end); node = { kind: 'source', start: i, end: next, raw: source.slice(i, next) } }
    flush(i)
    result.push(node)
    i = textStart = node.end
  }
  flush(end)
  return result
}

function rawBlock(source: string, start: number, end: number): VisualBlock {
  const raw = source.slice(start, end)
  return { kind: 'source', start, end, raw, summary: raw.trim().split(/\r?\n/)[0].slice(0, 120) }
}

function environmentClose(source: string, from: number, name: string, limit: number): number {
  const opening = `\\begin{${name}}`
  const closing = `\\end{${name}}`
  let depth = 1
  let cursor = from
  while (cursor < limit) {
    const nextOpen = source.indexOf(opening, cursor)
    const nextClose = source.indexOf(closing, cursor)
    if (nextClose < 0 || nextClose >= limit) return -1
    if (nextOpen >= 0 && nextOpen < nextClose) { depth++; cursor = nextOpen + opening.length; continue }
    depth--
    if (depth === 0) return nextClose
    cursor = nextClose + closing.length
  }
  return -1
}

function listItems(source: string, start: number, end: number): VisualBlock['items'] {
  const body = source.slice(start, end)
  const matches = [...body.matchAll(/\\item(?:\[[^\]]*\])?[ \t]*/g)]
  if (!matches.length) return []
  return matches.map((match, index) => {
    const contentStart = start + match.index + match[0].length
    const contentEnd = index + 1 < matches.length ? start + matches[index + 1].index : end
    return { span: { start: contentStart, end: contentEnd }, children: inline(source, contentStart, contentEnd) }
  })
}

function followingLabels(source: string, from: number, limit: number, multiline: boolean): { end: number; labels: NonNullable<VisualBlock['labels']> } {
  const labels: NonNullable<VisualBlock['labels']> = []
  let cursor = from
  while (cursor < limit) {
    const spacing = source.slice(cursor, limit).match(multiline ? /^\s*/ : /^[ \t]*/)?.[0] ?? ''
    const start = cursor + spacing.length
    if (!source.startsWith('\\label{', start)) break
    const value = group(source, start + '\\label'.length)
    if (!value || value.end >= limit) break
    const end = value.end + 1
    labels.push({ span: { start, end }, value })
    cursor = end
  }
  return { end: labels.length ? cursor : from, labels }
}

function commandArgument(source: string, start: number, end: number, command: string): SourceSpan | undefined {
  const pattern = new RegExp(`\\\\${command}(?:\\[[^\\]]*\\])?\\s*\\{`, 'g')
  pattern.lastIndex = start
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) && match.index < end) {
    const span = group(source, match.index + match[0].length - 1)
    if (span && span.end < end) return span
  }
}

function mediaBlock(source: string, start: number, end: number, kind: 'figure' | 'table'): VisualBlock {
  const raw = source.slice(start, end)
  const caption = commandArgument(source, start, end, 'caption')
  const assets = [...raw.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)].map(match => match[1])
  const labels: NonNullable<VisualBlock['labels']> = []
  for (const match of raw.matchAll(/\\label\{/g)) {
    const at = start + match.index
    const value = group(source, at + '\\label'.length)
    if (value && value.end < end) labels.push({ span: { start: at, end: value.end + 1 }, value })
  }
  let rows: string[][] | undefined
  let tableCells: VisualBlock['tableCells']
  if (kind === 'table') {
    const opening = /\\begin\{(tabular\*?|tabularx|longtable)\}(?:\[[^\]]*\])?/.exec(raw)
    if (opening) {
      let at = start + opening.index + opening[0].length
      const first = group(source, at)
      if (first) at = first.end + 1
      const second = opening[1] === 'tabularx' || opening[1] === 'tabular*' ? group(source, at) : null
      if (second) at = second.end + 1
      const closeAt = source.indexOf(`\\end{${opening[1]}}`, at)
      if (first && (second || opening[1] !== 'tabularx' && opening[1] !== 'tabular*') && closeAt >= 0 && closeAt < end) {
        const body = source.slice(at, closeAt)
        if (!/\\(?:multicolumn|multirow|begin|input|include|pgfplotstable)/.test(body)) {
          const parsed: NonNullable<VisualBlock['tableCells']> = []
          const rowPattern = /\\\\(?:\[[^\]]*\])?/g
          let rowStart = at
          let boundary: RegExpExecArray | null
          const addRow = (rowEnd: number) => {
            let cursor = rowStart
            while (cursor < rowEnd) {
              const prefix = source.slice(cursor, rowEnd).match(/^\s*(?:\\(?:toprule|midrule|bottomrule|hline|cline\{[^}]*\})\s*)*/)?.[0] ?? ''
              if (!prefix) break
              cursor += prefix.length
            }
            let limit = rowEnd
            while (limit > cursor && /\s/.test(source[limit - 1])) limit--
            if (limit <= cursor || /^\\(?:toprule|midrule|bottomrule|hline)\s*$/.test(source.slice(cursor, limit))) return
            const cells: NonNullable<VisualBlock['tableCells']>[number] = []
            let cellStart = cursor
            let depth = 0
            for (let position = cursor; position <= limit; position++) {
              const character = source[position]
              if (position < limit && character === '\\') { position++; continue }
              if (position < limit && character === '{') depth++
              if (position < limit && character === '}') depth--
              if (position === limit || character === '&' && depth === 0) {
                let from = cellStart; let to = position
                while (from < to && /\s/.test(source[from])) from++
                while (to > from && /\s/.test(source[to - 1])) to--
                cells.push({ span: { start: from, end: to }, children: inline(source, from, to) })
                cellStart = position + 1
              }
            }
            if (cells.some(cell => cell.span.end > cell.span.start)) parsed.push(cells)
          }
          while ((boundary = rowPattern.exec(body))) { addRow(at + boundary.index); rowStart = at + boundary.index + boundary[0].length }
          addRow(closeAt)
          if (parsed.length) { tableCells = parsed.slice(0, 80); rows = tableCells.map(row => row.map(cell => source.slice(cell.span.start, cell.span.end))) }
        }
      }
    }
  }
  return { kind, start, end, raw, caption, captionChildren: caption ? inline(source, caption.start, caption.end) : undefined, assets, rows, tableCells, labels }
}

function preambleField(source: string, limit: number, name: string): SourceSpan | undefined {
  const pattern = new RegExp(`\\\\${name}(?:\\[[^\\]]*\\])?\\{`, 'g')
  let match: RegExpExecArray | null
  let found: SourceSpan | undefined
  while ((match = pattern.exec(source)) && match.index < limit) {
    const value = group(source, match.index + match[0].length - 1)
    if (value && value.end < limit) found = value
  }
  return found
}

function parseBlocks(source: string, bodyStart: number, bodyEnd: number, title?: { title?: SourceSpan; author?: SourceSpan; date?: SourceSpan }): VisualBlock[] {
  const blocks: VisualBlock[] = []
  let i = bodyStart
  while (i < bodyEnd) {
    if (/\s/.test(source[i]) && (i === bodyStart || source.slice(i).match(/^\s+/)?.[0].includes('\n'))) {
      const space = source.slice(i, bodyEnd).match(/^\s+/)?.[0] ?? ''
      const limit = i + space.length
      let cursor = i
      let atLineStart = i === 0 || source[i - 1] === '\n'
      while (cursor < limit) {
        const newline = source.indexOf('\n', cursor)
        if (newline < 0 || newline >= limit) break
        if (atLineStart) {
          const contentEnd = source[newline - 1] === '\r' ? newline - 1 : newline
          blocks.push({ kind: 'blank', start: cursor, end: newline + 1, raw: source.slice(cursor, newline + 1), content: { start: cursor, end: contentEnd } })
        }
        cursor = newline + 1
        atLineStart = true
      }
      i += space.length
      continue
    }
    const rest = source.slice(i, Math.min(bodyEnd, i + 2048))
    const standaloneLabel = rest.match(/^[ \t]*\\label\{/)
    if (standaloneLabel) {
      const value = group(source, i + standaloneLabel[0].length - 1)
      if (value && value.end < bodyEnd) { i = value.end + 1; continue }
    }
    const fontSwitch = rest.match(/^[ \t]*\\(?:kaishu|itshape|bfseries|normalfont|noindent)(?=\s|\\|$)/)
    if (fontSwitch && !/^\s*\\noindent\s*\\colorbox/.test(rest)) { i += fontSwitch[0].length; continue }
    const makeTitle = rest.match(/^[ \t]*\\maketitle\b/)
    if (makeTitle) {
      const end = i + makeTitle[0].length
      blocks.push({ kind: 'title', start: i, end, raw: source.slice(i, end), ...title, children: title?.title ? inline(source, title.title.start, title.title.end) : [] })
      i = end
      continue
    }
    const highlight = rest.match(/^[ \t]*\\noindent\s*\\colorbox\s*\{([^{}]+)\}\s*\{/)
    if (highlight) {
      const box = group(source, i + highlight[0].length - 1)
      if (box && box.end < bodyEnd) {
        const parbox = source.slice(box.start, box.end).match(/^\s*%?\s*\\parbox\s*\{/)
        const width = parbox && group(source, box.start + parbox[0].length - 1)
        const innerStart = width ? source.slice(width.end + 1, box.end).match(/^\s*\{/) : null
        const content = innerStart ? group(source, width!.end + 1 + innerStart[0].length - 1) : null
        if (content && content.end <= box.end) {
          const end = box.end + 1
          blocks.push({ kind: 'highlight', start: i, end, raw: source.slice(i, end), name: highlight[1], content, children: inline(source, content.start, content.end) })
          i = end
          continue
        }
      }
    }
    const structured = rest.match(/^[ \t]*\\begin\{(abstract|proof|proposition|theorem|lemma|corollary|definition|remark|example)\}(?:\[([^\]]*)\])?/)
    if (structured) {
      const closeAt = environmentClose(source, i + structured[0].length, structured[1], bodyEnd)
      if (closeAt >= 0) {
        const end = closeAt + `\\end{${structured[1]}}`.length
        const attached = followingLabels(source, i + structured[0].length, closeAt, true)
        blocks.push({ kind: structured[1] === 'abstract' ? 'abstract' : 'theorem', name: structured[1] === 'abstract' ? '摘要' : structured[1], start: i, end, raw: source.slice(i, end), labels: attached.labels, body: parseBlocks(source, attached.end, closeAt), summary: structured[2] })
        i = end
        continue
      }
    }
    const heading = rest.match(/^[ \t]*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{/)
    if (heading) {
      const title = group(source, i + heading[0].length - 1)
      if (title && title.end < bodyEnd) {
        const attached = followingLabels(source, title.end + 1, bodyEnd, false)
        const end = attached.end
        blocks.push({ kind: 'heading', start: i, end, raw: source.slice(i, end), level: ({ part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 } as Record<string, number>)[heading[1]], title, labels: attached.labels, children: inline(source, title.start, title.end) })
        i = end
        continue
      }
    }
    const list = rest.match(/^[ \t]*\\begin\{(itemize|enumerate)\}/)
    if (list) {
      const close = `\\end{${list[1]}}`
      const closeAt = environmentClose(source, i + list[0].length, list[1], bodyEnd)
      if (closeAt >= 0 && closeAt < bodyEnd) {
        const end = closeAt + close.length
        if (/\\begin\{(?:itemize|enumerate)\}/.test(source.slice(i + list[0].length, closeAt))) blocks.push(rawBlock(source, i, end))
        else blocks.push({ kind: 'list', start: i, end, raw: source.slice(i, end), level: list[1] === 'enumerate' ? 1 : 0, items: listItems(source, i + list[0].length, closeAt) })
        i = end
        continue
      }
    }
    const media = rest.match(/^[ \t]*\\begin\{(figure\*?|table\*?|longtable|tabular\*?|tabularx|center)\}/)
    if (media) {
      const closeAt = environmentClose(source, i + media[0].length, media[1], bodyEnd)
      if (closeAt >= 0) {
        const end = closeAt + `\\end{${media[1]}}`.length
        if (media[1] !== 'center' || /\\begin\{(?:tabular\*?|tabularx|longtable)\}/.test(source.slice(i + media[0].length, closeAt))) {
          blocks.push(mediaBlock(source, i, end, media[1].startsWith('figure') ? 'figure' : 'table'))
          i = end
          continue
        }
      }
    }
    const standaloneImage = rest.match(/^[ \t]*\\includegraphics(?:\[[^\]]*\])?\s*\{[^{}]+\}/)
    if (standaloneImage) {
      const end = i + standaloneImage[0].length
      blocks.push(mediaBlock(source, i, end, 'figure'))
      i = end
      continue
    }
    const math = rest.match(/^[ \t]*(\\\[|\$\$|\\begin\{(?:equation\*?|align\*?|gather\*?|displaymath)\})/)
    if (math) {
      const opening = math[1]
      const closing = opening === '\\[' ? '\\]' : opening === '$$' ? '$$' : opening.replace('\\begin', '\\end')
      const contentStart = i + math[0].length
      const closeAt = source.indexOf(closing, contentStart)
      if (closeAt >= 0 && closeAt < bodyEnd) {
        const end = closeAt + closing.length
        const attached = followingLabels(source, contentStart, closeAt, true)
        let formulaEnd = closeAt
        const trailing = [...source.slice(attached.end, closeAt).matchAll(/\\label\{/g)].at(-1)
        const trailingStart = trailing ? attached.end + trailing.index : -1
        if (trailingStart >= 0) {
          const value = group(source, trailingStart + '\\label'.length)
          if (value && value.end < closeAt && /^\s*$/.test(source.slice(value.end + 1, closeAt))) {
            attached.labels.push({ span: { start: trailingStart, end: value.end + 1 }, value })
            formulaEnd = trailingStart
          }
        }
        blocks.push({ kind: 'math', start: i, end, raw: source.slice(i, end), content: { start: attached.end, end: formulaEnd }, labels: attached.labels })
        i = end
        continue
      }
    }
    if (/^[ \t]*%/.test(rest) || /^[ \t]*\\(?!textbf\b|textit\b|emph\b|colorbox\b|href\b|url\b|ref\b|eqref\b|cite\b)/.test(rest)) {
      const environment = rest.match(/^[ \t]*\\begin\{([^}]+)\}/)
      let end = source.indexOf('\n', i)
      end = end < 0 || end > bodyEnd ? bodyEnd : end
      if (environment) {
        const close = `\\end{${environment[1]}}`
        const closeAt = environmentClose(source, i + environment[0].length, environment[1], bodyEnd)
        end = closeAt >= 0 && closeAt < bodyEnd ? closeAt + close.length : bodyEnd
      }
      blocks.push(rawBlock(source, i, end))
      i = Math.max(end, i + 1)
      continue
    }
    let end = i
    while (end < bodyEnd) {
      const lineEnd = source.indexOf('\n', end)
      const next = lineEnd < 0 || lineEnd >= bodyEnd ? bodyEnd : lineEnd + 1
      end = next
      if (end >= bodyEnd || /^\s*$/.test(source.slice(end, source.indexOf('\n', end) < 0 ? bodyEnd : source.indexOf('\n', end)))) break
      if (/^[ \t]*\\(?:begin|end|section|subsection|subsubsection|chapter|part|paragraph|subparagraph|\[|maketitle|noindent\s*\\colorbox)|^[ \t]*\$\$|^[ \t]*%/.test(source.slice(end, Math.min(bodyEnd, end + 160)))) break
    }
    if (end <= i) end = Math.min(i + 1, bodyEnd)
    blocks.push({ kind: 'paragraph', start: i, end, raw: source.slice(i, end), children: inline(source, i, end) })
    i = end
  }
  return blocks
}

export function parseVisualLatex(source: string): VisualDocument {
  const begin = /\\begin\s*\{document\}/g.exec(source)
  if (!begin) return { source, blocks: [rawBlock(source, 0, source.length)], documentFound: false }
  const bodyStart = begin.index + begin[0].length
  const endDocument = /\\end\s*\{document\}/g
  endDocument.lastIndex = bodyStart
  const bodyEnd = endDocument.exec(source)?.index ?? source.length
  const title = { title: preambleField(source, begin.index, 'title'), author: preambleField(source, begin.index, 'author'), date: preambleField(source, begin.index, 'date') }
  const blocks = parseBlocks(source, bodyStart, bodyEnd, title)
  if (begin.index > 0) blocks.unshift(rawBlock(source, 0, bodyStart))
  if (bodyEnd < source.length) blocks.push(rawBlock(source, bodyEnd, source.length))
  return { source, blocks, documentFound: true }
}
