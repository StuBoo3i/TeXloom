import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import katex from 'katex'
import { Code2, Pencil, Play, Image as ImageIcon, Table2 } from 'lucide-react'
import { highlightCss } from './highlight'
import { CardPdfPreview } from './card-pdf-preview'
import { decodeText, draftCardKey, encodeText, parseVisualLatex, sourceOffsetForVisible, visibleOffsetForSource, type InlineNode, type SourceSpan, type VisualBlock } from './visual-latex'
import 'katex/dist/katex.min.css'
import './visual-editor.css'

type Edit = (span: SourceSpan, expected: string, replacement: string) => void

function Editable({ span, raw, prose = false, commitOnBlur = false, className = '', onEdit, onFocus, onBlur, onDeleteEmpty }: { span: SourceSpan; raw: string; prose?: boolean; commitOnBlur?: boolean; className?: string; onEdit: Edit; onFocus?: () => void; onBlur?: () => void; onDeleteEmpty?: () => void }) {
  const element = useRef<HTMLSpanElement>(null)
  const [editing, setEditing] = useState(false)
  const current = useRef({ span, raw })
  const dirty = useRef(false)
  const visible = prose ? decodeText(raw) : raw
  useLayoutEffect(() => {
    current.current = { span, raw }
    if (element.current && document.activeElement !== element.current && element.current.textContent !== visible) element.current.textContent = visible
  }, [span.start, span.end, raw, visible])
  const commit = (editable: HTMLElement) => {
    const value = editable.innerText.replace(/\r/g, '')
    const encoded = prose ? encodeText(value) : value
    const { span: position, raw: expected } = current.current
    const next = expected.includes('\r\n') ? encoded.replace(/(?<!\r)\n/g, '\r\n') : encoded
    if (next === expected) return
    onEdit(position, expected, next)
    current.current = { span: { start: position.start, end: position.start + next.length }, raw: next }
  }
  return <span ref={element} className={`visual-editable ${className}`} data-source-start={span.start} data-source-end={span.end} contentEditable={editing} suppressContentEditableWarning spellCheck={false} role="textbox" aria-label={onDeleteEmpty ? '编辑空行，按退格或删除键移除空行' : '编辑文本'} onClick={event => {
    // A normal drag must cross text and rendered formulae. Enter editing only after a click.
    if (!window.getSelection()?.isCollapsed) return
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY)
    const point = caret && event.currentTarget.contains(caret.startContainer) ? { node: caret.startContainer, offset: caret.startOffset } : null
    setEditing(true)
    requestAnimationFrame(() => {
      const host = element.current
      if (!host) return
      host.focus()
      const selection = window.getSelection()
      if (point && selection && host.contains(point.node)) {
        const range = document.createRange()
        range.setStart(point.node, point.offset)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    })
  }} onFocus={() => { dirty.current = false; onFocus?.() }} onBlur={event => { if (commitOnBlur && dirty.current) commit(event.currentTarget); dirty.current = false; setEditing(false); onBlur?.() }} onInput={event => { if (commitOnBlur) dirty.current = true; else commit(event.currentTarget) }} onKeyDown={event => {
    if (!onDeleteEmpty || (event.key !== 'Backspace' && event.key !== 'Delete') || event.currentTarget.textContent?.trim()) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    event.preventDefault()
    dirty.current = false
    onDeleteEmpty()
  }} />
}

function MathPreview({ value, display }: { value: string; display: boolean }) {
  const element = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!element.current) return
    try { katex.render(value, element.current, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore' }) }
    catch { element.current.textContent = value }
  }, [value, display])
  return <span ref={element} className={display ? 'visual-math-render display' : 'visual-math-render'} />
}

function MathEditor({ span, selectionSpan, value, previewValue, display, onEdit }: { span: SourceSpan; selectionSpan: SourceSpan; value: string; previewValue?: string; display: boolean; onEdit: Edit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const original = useRef(value)
  const cancelled = useRef(false)
  const save = () => {
    if (!cancelled.current && draft !== original.current) onEdit(span, original.current, draft)
    cancelled.current = false
    original.current = draft
    setEditing(false)
  }
  return <span className={`visual-math ${display ? 'display' : ''}`} data-source-start={selectionSpan.start} data-source-end={selectionSpan.end} data-source-atomic="true">
    {editing ? <span className="visual-math-input"><textarea autoFocus aria-label="编辑公式源码" rows={display ? 3 : 1} value={draft} onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === 'Escape') { cancelled.current = true; setDraft(original.current); setEditing(false) } if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.blur() }} /></span> : <><MathPreview value={previewValue ?? value} display={display} /><button type="button" aria-label="编辑公式" title="编辑公式源码" onClick={() => { cancelled.current = false; original.current = value; setDraft(value); setEditing(true) }}><Pencil size={13} /></button></>}
  </span>
}

function SourceEditor({ block, onEdit, onClose }: { block: VisualBlock; onEdit: Edit; onClose: () => void }) {
  const [draft, setDraft] = useState(block.raw)
  const apply = () => { if (draft !== block.raw) onEdit(block, block.raw, draft); onClose() }
  return <div className="visual-source-editor"><textarea autoFocus aria-label="原位编辑源码" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') onClose(); if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') apply() }} /><div><button type="button" onClick={onClose}>取消</button><button type="button" onClick={apply}>应用源码</button></div></div>
}

function SourceBlock({ block, onEdit }: { block: VisualBlock; onEdit: Edit }) {
  const [open, setOpen] = useState(false)
  return <div className="visual-source-block" data-block-start={block.start} data-block-end={block.end}><button type="button" className="visual-source-summary" aria-expanded={open} onClick={() => setOpen(!open)}><Code2 size={15} /><span>{block.summary || '源码块'}</span><small>{open ? '收起' : '展开源码'}</small></button>{open && <SourceEditor block={block} onEdit={onEdit} onClose={() => setOpen(false)} />}</div>
}

function MediaCard({ block, projectId, source, assetPath, draftIncluded, onToggleDraft, onEdit, onCompile, onReview, onFocus, onBlur }: { block: VisualBlock; projectId: string; source: string; assetPath: (name: string) => string; draftIncluded: boolean; onToggleDraft: (block: VisualBlock) => void; onEdit: Edit; onCompile: (block: VisualBlock) => Promise<string>; onReview: (block: VisualBlock) => void; onFocus: () => void; onBlur: () => void }) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(() => block.kind === 'table' && Boolean(block.tableCells?.length))
  const [pdfUrl, setPdfUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setPdfUrl(''); setError('') }, [block.raw])
  const title = block.kind === 'figure' ? '图片' : '表格'
  const draftSupported = !/^\s*\\begin\{(?:longtable|tabular\*?|tabularx|center)\}/.test(block.raw) && !(block.labels?.length && !block.caption)
  const preview = () => { setPreviewOpen(value => !value) }
  const compile = async () => {
    setBusy(true); setError('')
    try { setPdfUrl(await onCompile(block)); setPreviewOpen(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="visual-media-card" data-block-start={block.start} data-block-end={block.end}>
    <div className="visual-media-head">{block.kind === 'figure' ? <ImageIcon size={17} /> : <Table2 size={17} />}<strong>{title}</strong><span>{block.assets?.[0] ?? `${block.rows?.length ?? 0} 行`}</span></div>
    {block.captionChildren?.length ? <div className="visual-media-caption" aria-label={block.kind === 'figure' ? '完整图注' : '完整表注'}>{block.captionChildren.map((node, index) => <Inline key={index} node={node} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption />)}</div> : <div className="visual-media-caption empty">{block.kind === 'figure' ? '暂无图注' : '暂无表注'}</div>}
    <div className="visual-media-actions"><button type="button" onClick={preview}>{previewOpen ? '收起预览' : '查看预览'}</button><button type="button" onClick={() => setSourceOpen(value => !value)}><Code2 size={13} />{sourceOpen ? '收起源码' : '查看源码'}</button><button type="button" onClick={() => onReview(block)}>评论</button>{draftSupported ? <label className="visual-draft-toggle"><input type="checkbox" checked={draftIncluded} onChange={() => onToggleDraft(block)} />纳入草稿 PDF</label> : <span className="visual-draft-toggle">此结构始终完整编译</span>}<button type="button" disabled={busy} onClick={() => void compile()}><Play size={12} />{busy ? '编译中…' : '编译此卡片'}</button></div>
    {previewOpen && <div className={`visual-media-preview ${pdfUrl ? 'compiled' : ''}`}>{pdfUrl ? <CardPdfPreview url={pdfUrl} /> : block.kind === 'figure' && block.assets?.length ? block.assets.map(name => { const resolved = assetPath(name); return /\.(png|jpe?g)$/i.test(resolved) ? <img key={name} loading="lazy" alt={title} src={`/api/projects/${encodeURIComponent(projectId)}/asset?path=${encodeURIComponent(resolved)}`} /> : <div key={name} className="visual-media-placeholder">{name} · 点击编译查看排版</div> }) : block.tableCells?.length ? <><small className="visual-table-hint">结构预览 · 精确排版以 PDF 为准</small><table><tbody>{block.tableCells.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell.children.map((node, nodeIndex) => <Inline key={nodeIndex} node={node} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption />)}</td>)}</tr>)}</tbody></table></> : <div className="visual-media-placeholder">复杂图表需编译后查看排版</div>}</div>}
    {!previewOpen && <div className="visual-media-placeholder">预览尚未加载 · 按需打开以减少长文档资源占用</div>}
    {error && <p role="alert" className="visual-media-error">{error}</p>}
    {sourceOpen && <SourceEditor block={block} onEdit={onEdit} onClose={() => setSourceOpen(false)} />}
  </section>
}

function readableCaptionCommand(raw: string): string {
  if (raw === '\\\\') return '\n'
  const command = /^\\([A-Za-z@]+\*?|.)/.exec(raw)?.[1] ?? ''
  const symbols: Record<string, string> = { LaTeX: 'LaTeX', TeX: 'TeX', textendash: '–', textemdash: '—', ldots: '…', dots: '…', quad: ' ', qquad: '  ', newline: '\n', par: '\n', textasciitilde: '~', textbackslash: '\\', protect: '', centering: '', small: '', footnotesize: '', normalsize: '', hspace: ' ', vspace: '' }
  if (command in symbols) return symbols[command]
  const arguments_ = [...raw.matchAll(/\{([^{}]*)\}/g)]
  return arguments_.at(-1)?.[1] ?? ''
}

function Inline({ node, source, onEdit, onFocus, onBlur, caption = false }: { node: InlineNode; source: string; onEdit: Edit; onFocus: () => void; onBlur: () => void; caption?: boolean }) {
  if (node.kind === 'text') return <Editable span={node} raw={node.raw} prose onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />
  if (node.kind === 'bold' || node.kind === 'italic') {
    const children = node.children?.map((child, index) => <Inline key={index} node={child} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption={caption} />)
    return node.kind === 'bold' ? <strong className="visual-format">{children}</strong> : <em className="visual-format">{children}</em>
  }
  if (node.kind === 'highlight') return <mark className="visual-inline-highlight" style={{ backgroundColor: highlightCss(node.name) }}>{node.children?.map((child, index) => <Inline key={index} node={child} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption={caption} />)}</mark>
  if (node.kind === 'math' && node.value) return <MathEditor span={node.value} selectionSpan={node} value={source.slice(node.value.start, node.value.end)} display={false} onEdit={onEdit} />
  if (node.kind === 'reference' || node.kind === 'citation') return <span className={`visual-token ${node.kind}`} title={node.raw}><span>{node.kind === 'reference' ? '↗' : '❝'}</span>{node.value && <Editable span={node.value} raw={source.slice(node.value.start, node.value.end)} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />}</span>
  if (node.kind === 'link') return <span className="visual-link" title={node.raw}>↗ {node.children?.length ? node.children.map((child, index) => <Inline key={index} node={child} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption={caption} />) : node.label && <Editable span={node.label} raw={source.slice(node.label.start, node.label.end)} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />}{node.target && node.label !== node.target && <Editable className="visual-link-target" span={node.target} raw={source.slice(node.target.start, node.target.end)} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />}</span>
  return caption ? <span className="visual-caption-fallback" title="可在查看源码中精确修改">{readableCaptionCommand(node.raw)}</span> : <code className="visual-inline-source" title="复杂命令：在 Code 模式或源码块中编辑">{node.raw}</code>
}

export function VisualEditor({ source, projectId, file, assetPath, draftCards, onToggleDraft, onEdit, onCompileCard, onReviewCard, onUndo, onRedo, onFocus, onBlur, onSelection, onViewport, target }: { source: string; projectId: string; file: string; assetPath: (name: string) => string; draftCards: string[]; onToggleDraft: (block: VisualBlock) => void; onEdit: Edit; onCompileCard: (block: VisualBlock) => Promise<string>; onReviewCard: (block: VisualBlock) => void; onUndo: () => void; onRedo: () => void; onFocus: () => void; onBlur: () => void; onSelection: (span: SourceSpan) => void; onViewport: (offset: number) => void; target: { offset: number; serial: number } | null }) {
  const document = useMemo(() => parseVisualLatex(source), [source])
  const root = useRef<HTMLDivElement>(null)
  const scrollFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), [])
  useLayoutEffect(() => {
    if (!target || !root.current) return
    const host = root.current
    const blocks = [...host.querySelectorAll<HTMLElement>('[data-block-start]')]
    const containing = blocks.filter(block => Number(block.dataset.blockStart) <= target.offset && target.offset < Number(block.dataset.blockEnd))
    const chosen = containing.sort((a, b) => (Number(a.dataset.blockEnd) - Number(a.dataset.blockStart)) - (Number(b.dataset.blockEnd) - Number(b.dataset.blockStart)))[0]
      ?? blocks.reduce<HTMLElement | null>((best, block) => !best || Math.abs(Number(block.dataset.blockStart) - target.offset) < Math.abs(Number(best.dataset.blockStart) - target.offset) ? block : best, null)
    if (chosen) {
      host.querySelector('.visual-target')?.classList.remove('visual-target')
      chosen.classList.add('visual-target')
      window.setTimeout(() => chosen.classList.remove('visual-target'), 1800)
      let top = chosen.getBoundingClientRect().top
      const editable = [...chosen.querySelectorAll<HTMLElement>('[data-source-start]')].find(item => Number(item.dataset.sourceStart) <= target.offset && target.offset <= Number(item.dataset.sourceEnd))
      if (editable?.firstChild?.nodeType === Node.TEXT_NODE) {
        const start = Number(editable.dataset.sourceStart)
        const end = Number(editable.dataset.sourceEnd)
        const character = Math.min(editable.firstChild.textContent?.length ?? 0, visibleOffsetForSource(source.slice(start, end), target.offset - start))
        const range = window.document.createRange()
        range.setStart(editable.firstChild, character)
        range.collapse(true)
        top = range.getBoundingClientRect().top || top
      }
      host.scrollTop += top - host.getBoundingClientRect().top - host.clientHeight * .18
    }
  }, [target?.serial])
  const reportViewport = () => {
    const host = root.current
    if (!host) return
    const top = host.getBoundingClientRect().top + 70
    const editable = [...host.querySelectorAll<HTMLElement>('[data-source-start]')].find(item => item.getBoundingClientRect().bottom > top)
    if (editable) {
      const rect = editable.getBoundingClientRect()
      const caret = window.document.caretRangeFromPoint?.(rect.left + 3, Math.max(top, rect.top + 3))
      if (caret && editable.contains(caret.startContainer)) {
        const prefix = window.document.createRange()
        prefix.selectNodeContents(editable)
        prefix.setEnd(caret.startContainer, caret.startOffset)
        const start = Number(editable.dataset.sourceStart)
        const end = Number(editable.dataset.sourceEnd)
        onViewport(start + sourceOffsetForVisible(source.slice(start, end), prefix.toString().length))
        return
      }
    }
    const blocks = [...host.querySelectorAll<HTMLElement>('[data-block-start]')].filter(block => block.getBoundingClientRect().bottom > top)
    if (blocks.length) onViewport(Number(blocks[0].dataset.blockStart))
  }
  const renderInline = (nodes: InlineNode[] | undefined) => nodes?.map((node, index) => <Inline key={index} node={node} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />)
  const selectedSourceSpan = (): SourceSpan | null => {
    const selection = window.getSelection()
    const host = root.current
    if (!selection?.rangeCount || !host) return null
    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null
    const offset = (node: Node, at: number, endBoundary: boolean) => {
      const element = node instanceof Element ? node : node.parentElement
      let item = element?.closest<HTMLElement>('[data-source-start]')
      if (!item) {
        // A range can end between inline nodes, rather than inside either node.
        const children = node.childNodes
        const neighbor = endBoundary ? children[at - 1] : children[at]
        const adjacent = neighbor instanceof Element ? neighbor : neighbor?.parentElement
        const matches = adjacent?.matches('[data-source-start]') ? [adjacent as HTMLElement] : [...(adjacent?.querySelectorAll<HTMLElement>('[data-source-start]') ?? [])]
        item = endBoundary ? matches.at(-1) : matches[0]
        if (!item) {
          const block = element?.closest<HTMLElement>('[data-block-start]')
          return Number(endBoundary ? block?.dataset.blockEnd : block?.dataset.blockStart)
        }
        return Number(endBoundary ? item.dataset.sourceEnd : item.dataset.sourceStart)
      }
      const start = Number(item.dataset.sourceStart)
      const end = Number(item.dataset.sourceEnd)
      if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('无效的可视化选区')
      if (item.dataset.sourceAtomic) return endBoundary ? end : start
      if (!item.contains(node)) return endBoundary ? end : start
      const prefix = window.document.createRange()
      prefix.selectNodeContents(item)
      prefix.setEnd(node, at)
      return start + sourceOffsetForVisible(source.slice(start, end), prefix.toString().length)
    }
    try {
      const start = offset(range.startContainer, range.startOffset, false)
      const end = offset(range.endContainer, range.endOffset, true)
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null
      return { start: Math.min(start, end), end: Math.max(start, end) }
    } catch { return null /* ignore transient DOM selection */ }
  }
  const captureSelection = () => {
    const span = selectedSourceSpan()
    if (span) onSelection(span)
    return Boolean(span)
  }
  useEffect(() => {
    const deleteSelection = (event: KeyboardEvent) => {
      if ((event.key !== 'Backspace' && event.key !== 'Delete') || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const selection = window.getSelection()
      const host = root.current
      if (!selection?.rangeCount || selection.isCollapsed || !host) return
      const range = selection.getRangeAt(0)
      if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return
      const target = event.target
      if (!(target instanceof Node) || !host.contains(target)) return
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return
      const editable = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.visual-editable')
      const first = editable(range.startContainer)
      if (first && first === editable(range.endContainer) && first.isContentEditable) return
      const span = selectedSourceSpan()
      if (!span || span.end <= span.start) return
      event.preventDefault()
      event.stopPropagation()
      selection.removeAllRanges()
      onEdit(span, source.slice(span.start, span.end), '')
      onSelection({ start: span.start, end: span.start })
    }
    window.document.addEventListener('keydown', deleteSelection, true)
    return () => window.document.removeEventListener('keydown', deleteSelection, true)
  }, [source, onEdit, onSelection])
  const renderBlock = (block: VisualBlock, index: number): ReactNode => {
    if (block.kind === 'blank' && block.content) return <div key={index} className="visual-blank-line" data-block-start={block.start} data-block-end={block.end}><Editable className="visual-blank-editable" span={block.content} raw={source.slice(block.content.start, block.content.end)} commitOnBlur onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} onDeleteEmpty={() => onEdit(block, block.raw, '')} /></div>
    if (block.kind === 'source') return <SourceBlock key={`${index}-source`} block={block} onEdit={onEdit} />
    if (block.kind === 'figure' || block.kind === 'table') return <MediaCard key={draftCardKey(file, block, source)} block={block} projectId={projectId} source={source} assetPath={assetPath} draftIncluded={draftCards.includes(draftCardKey(file, block, source))} onToggleDraft={onToggleDraft} onEdit={onEdit} onCompile={onCompileCard} onReview={onReviewCard} onFocus={onFocus} onBlur={onBlur} />
    if (block.kind === 'title') return <header key={index} className="visual-title" data-block-start={block.start} data-block-end={block.end}>{block.title ? <h1>{renderInline(block.children)}</h1> : <span>标题</span>}{block.author && <div className="visual-title-author"><Editable span={block.author} raw={source.slice(block.author.start, block.author.end)} prose onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} /></div>}{block.date && <div className="visual-title-date"><Editable span={block.date} raw={source.slice(block.date.start, block.date.end)} prose onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} /></div>}</header>
    if (block.kind === 'abstract' || block.kind === 'theorem') return <section key={index} className={`visual-structured ${block.kind} visual-${block.name}`} data-block-start={block.start} data-block-end={block.end}><div className="visual-structured-title">{block.kind === 'abstract' ? '摘要' : ({ proof: '证明', proposition: '命题', theorem: '定理', lemma: '引理', corollary: '推论', definition: '定义', remark: '说明', example: '例' } as Record<string, string>)[block.name ?? ''] ?? block.name}{block.summary && <span>（{block.summary}）</span>}</div><div className="visual-structured-body">{block.body?.map(renderBlock)}</div></section>
    if (block.kind === 'highlight') return <aside key={index} className="visual-highlight" style={{ backgroundColor: highlightCss(block.name) }} data-block-start={block.start} data-block-end={block.end}>{renderInline(block.children)}</aside>
    if (block.kind === 'heading') { const Heading = `h${Math.min(block.level ?? 2, 6)}` as 'h1'; return <Heading key={index} className="visual-heading" data-block-start={block.start} data-block-end={block.end}>{renderInline(block.children)}</Heading> }
    if (block.kind === 'paragraph') return <p key={index} className="visual-paragraph" data-block-start={block.start} data-block-end={block.end}>{renderInline(block.children)}</p>
    if (block.kind === 'math' && block.content) {
      const value = source.slice(block.content.start, block.content.end)
      const previewValue = /^\s*\\begin\{align/.test(block.raw) ? `\\begin{aligned}${value}\\end{aligned}` : /^\s*\\begin\{gather/.test(block.raw) ? `\\begin{gathered}${value}\\end{gathered}` : value
      return <div key={index} className="visual-display-math" data-block-start={block.start} data-block-end={block.end}><MathEditor span={block.content} selectionSpan={block} value={value} previewValue={previewValue} display onEdit={onEdit} /></div>
    }
    if (block.kind === 'list') { const items = block.items?.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item.children)}</li>); return block.level ? <ol key={index} className="visual-list" data-block-start={block.start} data-block-end={block.end}>{items}</ol> : <ul key={index} className="visual-list" data-block-start={block.start} data-block-end={block.end}>{items}</ul> }
    return null
  }
  return <div ref={root} className="visual-editor" tabIndex={-1} onScroll={() => { if (scrollFrame.current) return; scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = 0; reportViewport() }) }} onPointerDownCapture={() => {
    const active = window.document.activeElement
    if (active instanceof HTMLElement && active.classList.contains('visual-editable') && root.current?.contains(active)) {
      active.contentEditable = 'false'
      active.blur()
    }
  }} onPointerUp={event => { const block = (event.target as HTMLElement).closest<HTMLElement>('[data-block-start]'); queueMicrotask(() => { if (!captureSelection() && block) onSelection({ start: Number(block.dataset.blockStart), end: Number(block.dataset.blockStart) }); const selection = window.getSelection(); if (selection && !selection.isCollapsed && root.current && !root.current.contains(window.document.activeElement)) root.current.focus({ preventScroll: true }) }) }} onKeyUp={captureSelection} onFocusCapture={() => queueMicrotask(captureSelection)} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.target as HTMLElement).blur(); onUndo() }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); (event.target as HTMLElement).blur(); onRedo() }
  }}>
    <div className="visual-page">{!document.documentFound && <p className="visual-warning">未找到完整文档结构，当前以源码块显示。</p>}{document.blocks.map(renderBlock)}</div>
  </div>
}
