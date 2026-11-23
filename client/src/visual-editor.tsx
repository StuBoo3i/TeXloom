import { t } from './i18n'
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'
import { Code2, Pencil, Play, Image as ImageIcon, Table2 } from 'lucide-react'
import { highlightCss } from './highlight'
import { CardPdfPreview } from './card-pdf-preview'
import { latexSuggestions, type CompletionContext, type LatexSuggestion } from './latex-completion'
import { adjacentBlank, decodeText, draftCardKey, encodeText, parseVisualLatex, sourceOffsetForVisible, visibleOffsetForSource, type InlineNode, type SourceSpan, type VisualBlock } from './visual-latex'
import 'katex/dist/katex.min.css'
import './visual-editor.css'

type Edit = (span: SourceSpan, expected: string, replacement: string) => void
type NavigateReference = (kind: 'reference' | 'citation', key: string) => void
type ResumeEdit = { source: string; selection: SourceSpan; after: number }
const VisualCompletion = createContext<{
  source: string
  context: CompletionContext
  resume: (request: ResumeEdit) => void
  continuationOffset?: number
  navigateReference: NavigateReference
  crlf: boolean
} | null>(null)
const focusVisualField = new WeakMap<HTMLElement, (selection: SourceSpan) => void>()

type CompletionInput = { value: string; caret: number; selectionEnd: number }

function completionText(item: LatexSuggestion) {
  let removed = 0
  let placeholder: [number, number] | null = null
  const text = item.snippet ? item.insert.replace(/\$\{(\d+):([^}]*)\}|\$0/g, (token, number, label, offset) => {
    const value = label ?? ''
    const start = offset - removed
    if (!placeholder && number) placeholder = [start, start + value.length]
    removed += token.length - value.length
    return value
  }) : item.insert
  return { text, selection: placeholder ?? [text.length, text.length] as [number, number] }
}

function useCompletionMenu<T extends HTMLElement>(
  input: { current: T | null },
  read: (element: T) => CompletionInput | null,
  suggestions: (value: string, caret: number) => LatexSuggestion[],
  accept: (item: LatexSuggestion, input: CompletionInput) => void,
  layoutKey?: string,
  explicit = false,
) {
  const list = useRef<HTMLSpanElement>(null)
  const id = useId()
  const [result, setResult] = useState<{ items: LatexSuggestion[]; value: string; caret: number } | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null)
  const dismiss = () => setResult(null)
  const update = (target: T) => {
    const field = read(target)
    if (!field || field.caret !== field.selectionEnd) { dismiss(); return }
    const { value, caret } = field
    const items = suggestions(value, caret)
    setResult(items.length ? { items, value, caret } : null)
    setActive(explicit ? null : 0)
  }
  const open = Boolean(result)
  useLayoutEffect(() => {
    const panel = list.current
    if (active === null) return
    const option = panel?.children[active] as HTMLElement | undefined
    if (!panel || !option) return
    if (option.offsetTop < panel.scrollTop) panel.scrollTop = option.offsetTop
    const bottom = option.offsetTop + option.offsetHeight
    if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight
  }, [active, result, position])
  useLayoutEffect(() => {
    if (!open) return
    const layout = () => {
      const field = input.current
      const container = field?.closest('.visual-editor')
      if (!field || !container) return
      const selection = window.getSelection()
      const caret = field.isContentEditable && selection?.isCollapsed && selection.anchorNode && field.contains(selection.anchorNode)
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null
      const box = caret?.height ? caret : field.getBoundingClientRect()
      const viewport = container.getBoundingClientRect()
      if (box.bottom <= viewport.top || box.top >= viewport.bottom) { setPosition(null); return }
      const below = Math.min(window.innerHeight, viewport.bottom) - box.bottom - 6
      const above = box.top - Math.max(0, viewport.top) - 6
      const width = Math.min(Math.max(205, box.width), viewport.width, window.innerWidth - 12)
      const showAbove = below < 140 && above > below
      setPosition({
        left: Math.max(6, Math.min(box.left, viewport.right - width, window.innerWidth - width - 6)),
        top: showAbove ? box.top - 4 : box.bottom + 4,
        width,
        maxHeight: Math.min(220, showAbove ? above : below),
        above: showAbove,
      })
    }
    layout()
    const onScroll = (event: Event) => { if (event.target !== list.current) layout() }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', layout)
    const observer = new ResizeObserver(layout)
    if (input.current) observer.observe(input.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', layout)
    }
  }, [open, result?.value, result?.caret, layoutKey, input])
  const choose = (item: LatexSuggestion) => {
    const field = input.current && read(input.current)
    dismiss()
    if (field && result && field.value === result.value && field.caret === result.caret && field.selectionEnd === result.caret) accept(item, field)
  }
  const onKeyDown = (event: React.KeyboardEvent<T>) => {
    if (event.nativeEvent.isComposing) return true
    if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
      event.preventDefault()
      update(event.currentTarget)
      return true
    }
    if (!result || !position) return false
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) { dismiss(); return false }
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const count = result.items.length
      const down = event.key === 'ArrowDown'
      setActive(index => index === null ? (down ? 0 : count - 1) : (index + (down ? 1 : count - 1)) % count)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const choice = active ?? (event.key === 'Tab' && result.items.length === 1 ? 0 : null)
      if (choice === null) {
        if (event.key === 'Enter') { dismiss(); return false }
        event.preventDefault()
        setActive(0)
        return true
      }
      event.preventDefault()
      choose(result.items[choice])
      return true
    }
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); return true }
    return false
  }
  const menu = result && position && createPortal(
    <span ref={list} id={id} className="visual-completion" role="listbox" aria-label={t("LaTeX 自动补全")}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: Math.max(32, position.maxHeight), transform: position.above ? 'translateY(-100%)' : undefined }}>
      {result.items.map((item, index) => <button type="button" role="option" tabIndex={-1} id={id + '-' + index} aria-selected={index === active} key={item.label}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation() }}
        onPointerUp={event => event.stopPropagation()}
        onClick={() => choose(item)}><code>{item.label}</code><span>{t(item.detail)}</span></button>)}
    </span>, document.body)
  return {
    aria: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': menu ? id : undefined,
      'aria-activedescendant': menu && active !== null ? id + '-' + active : undefined,
    },
    onKeyDown, menu, dismiss, update,
    onSelect: (target: T) => {
      const field = read(target)
      if (result && (!field || field.caret !== result.caret || field.selectionEnd !== result.caret)) dismiss()
    },
  }
}

function useSourceCompletion(span: SourceSpan, draft: string, setDraft: (value: string) => void) {
  const workspace = useContext(VisualCompletion)
  const input = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const pendingSelection = useRef<[number, number] | null>(null)
  const completion = useCompletionMenu(input,
    field => ({ value: field.value, caret: field.selectionStart, selectionEnd: field.selectionEnd }),
    (value, caret) => {
      if (!workspace || composing.current) return []
      const nextSource = workspace.source.slice(0, span.start) + value + workspace.source.slice(span.end)
      return latexSuggestions(nextSource, span.start + caret, workspace.context)
        .filter(item => item.replaceFrom >= span.start)
        .map(item => ({ ...item, replaceFrom: item.replaceFrom - span.start }))
    },
    (item, field) => {
      const { text, selection } = completionText(item)
      pendingSelection.current = [item.replaceFrom + selection[0], item.replaceFrom + selection[1]]
      setDraft(field.value.slice(0, item.replaceFrom) + text + field.value.slice(field.caret))
    },
    draft)
  useLayoutEffect(() => {
    if (pendingSelection.current && input.current) {
      input.current.setSelectionRange(...pendingSelection.current)
      pendingSelection.current = null
    }
  })
  return {
    ...completion,
    onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => composing.current || completion.onKeyDown(event),
    fieldProps: {
      ...completion.aria,
      ref: input,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { setDraft(event.currentTarget.value); completion.update(event.currentTarget) },
      onSelect: (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
        completion.onSelect(event.currentTarget)
      },
      onCompositionStart: () => { composing.current = true; completion.dismiss() },
      onCompositionEnd: (event: React.CompositionEvent<HTMLTextAreaElement>) => { composing.current = false; completion.update(event.currentTarget) },
    },
  }
}

function readProseField(field: HTMLElement): CompletionInput | null {
  const selection = window.getSelection()
  if (!selection?.isCollapsed || !selection.anchorNode || !field.contains(selection.anchorNode)) return null
  const prefix = document.createRange()
  prefix.selectNodeContents(field)
  prefix.setEnd(selection.anchorNode, selection.anchorOffset)
  const value = field.innerText.replace(/\r/g, '')
  const before = prefix.toString().replace(/\r/g, '')
  if (!value.startsWith(before)) return null
  return { value, caret: before.length, selectionEnd: before.length }
}

function selectText(element: HTMLElement, start: number, end = start) {
  const node = element.firstChild ?? element
  const length = node.nodeType === Node.TEXT_NODE ? node.textContent?.length ?? 0 : 0
  const range = document.createRange()
  range.setStart(node, Math.min(start, length))
  range.setEnd(node, Math.min(end, length))
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const argumentCommands = /^\\(?:ref|eqref|autoref|pageref|cref|Cref|cite|citep|citet|input|include)$/
const commandDraftPattern = /^\\(?:[A-Za-z@]*|[A-Za-z@]+\*?(?:\[[^\]]*\])?[ \t]*\{[^{}\r\n]*)$/

function Editable({ span, raw, prose = false, commitOnBlur = false, className = '', onEdit, onFocus, onBlur, onDeleteEmpty }: { span: SourceSpan; raw: string; prose?: boolean; commitOnBlur?: boolean; className?: string; onEdit: Edit; onFocus?: () => void; onBlur?: () => void; onDeleteEmpty?: () => void }) {
  const workspace = useContext(VisualCompletion)
  const element = useRef<HTMLSpanElement>(null)
  const [editing, setEditing] = useState(false)
  const current = useRef({ span, raw })
  const dirty = useRef(false)
  const composing = useRef(false)
  const commandDraft = useRef<{ start: number; end: number; value: string } | null>(null)
  const pendingSelection = useRef<SourceSpan | null>(null)
  const visible = prose ? decodeText(raw) : raw
  useLayoutEffect(() => {
    current.current = { span, raw }
    if (element.current && document.activeElement !== element.current && element.current.textContent !== visible) element.current.textContent = visible
  }, [span.start, span.end, raw, visible])
  const applySelection = (field: HTMLSpanElement, selection: SourceSpan) => {
    const toVisible = (offset: number) => prose ? visibleOffsetForSource(raw, offset - span.start) : offset - span.start
    field.focus({ preventScroll: true })
    selectText(field, toVisible(selection.start), toVisible(selection.end))
  }
  useLayoutEffect(() => {
    const field = element.current
    if (!field) return
    focusVisualField.set(field, selection => {
      if (field.isContentEditable) applySelection(field, selection)
      else { pendingSelection.current = selection; setEditing(true) }
    })
    if (editing && pendingSelection.current) {
      applySelection(field, pendingSelection.current)
      pendingSelection.current = null
    }
    return () => { focusVisualField.delete(field) }
  })
  const commit = (encoded: string) => {
    const { span: position, raw: expected } = current.current
    if (encoded === expected) return
    onEdit(position, expected, encoded)
    current.current = { span: { start: position.start, end: position.start + encoded.length }, raw: encoded }
  }
  const normalizeLines = (value: string) => (workspace?.crlf ?? raw.includes('\r\n')) ? value.replace(/(?<!\r)\n/g, '\r\n') : value
  const plainText = (value: string) => normalizeLines(prose ? encodeText(value) : value)
  const completion = useCompletionMenu(element, readProseField, (value, caret) => {
    const draft = commandDraft.current
    if (!workspace || composing.current || !draft || value !== draft.value || caret <= draft.start || caret > draft.end) return []
    const begin = draft.start
    const command = value.slice(begin, caret)
    const { span: position } = current.current
    const prefix = workspace.source.slice(0, position.start) + plainText(value.slice(0, begin))
    const source = prefix + command + workspace.source.slice(position.end)
    return latexSuggestions(source, prefix.length + command.length, workspace.context)
      .filter(item => item.replaceFrom >= prefix.length)
      .map(item => ({ ...item, replaceFrom: begin + item.replaceFrom - prefix.length }))
      .filter(item => item.label !== 'document' || !/^\\(?:begin|end)\{/.test(command))
      .sort((left, right) => {
        const rank = (item: LatexSuggestion) => {
          const prefix = value.slice(item.replaceFrom, caret)
          return item.label === prefix ? 0 : item.label.startsWith(prefix) ? 1 : 2
        }
        return rank(left) - rank(right)
      })
  }, (item, field) => {
    const draft = commandDraft.current
    if (!workspace || !draft) return
    const head = field.value.slice(0, draft.start)
    const tail = field.value.slice(draft.end)
    const typed = field.value.slice(draft.start, item.replaceFrom)
    const { text, selection } = completionText(item)
    const host = element.current
    if (!typed && host && argumentCommands.test(text)) {
      // Keep the command in the input until a project key or file is selected.
      const next = head + text + '{' + tail
      const end = head.length + text.length + 1
      host.textContent = next
      selectText(host, end)
      commandDraft.current = { start: draft.start, end, value: next }
      completion.update(host)
      return
    }
    let inserted = typed + text
    if (typed.includes('{')) inserted += '}'
    const environment = /^\\begin\{([^{}]+)\}$/.exec(inserted)
    if (environment) inserted += '\n\n\\end{' + environment[1] + '}'
    const math = item.kind === 'symbol'
    if (math) inserted = '$' + inserted + '$'
    const position = current.current.span
    const prefix = plainText(head)
    const replacement = prefix + normalizeLines(inserted) + plainText(tail)
    const after = position.start + prefix.length + normalizeLines(inserted).length
    const selectionStart = position.start + prefix.length + normalizeLines(typed + text.slice(0, selection[0])).length + Number(math)
    const selectionEnd = position.start + prefix.length + normalizeLines(typed + text.slice(0, selection[1])).length + Number(math)
    commandDraft.current = null
    dirty.current = false
    host?.blur()
    workspace.resume({
      source: workspace.source.slice(0, position.start) + replacement + workspace.source.slice(position.end),
      selection: selectionStart === selectionEnd ? { start: after, end: after } : { start: selectionStart, end: selectionEnd },
      after,
    })
    commit(replacement)
  }, undefined, true)
  const handleInput = (field: HTMLSpanElement, data?: string | null) => {
    const trigger = prose && data?.startsWith('\\') ? data : null
    const draft = commandDraft.current
    const selection = trigger || draft ? readProseField(field) : null
    if (selection) {
      const { value, caret } = selection
      const head = draft ? draft.value.slice(0, draft.start) : ''
      const tail = draft ? draft.value.slice(draft.end) : ''
      const start = trigger ? caret - trigger.length : draft?.start
      const end = trigger ? caret : value.length - tail.length
      if (start !== undefined && start < caret && caret <= end
        && (trigger || (value.startsWith(head) && value.endsWith(tail)))
        && commandDraftPattern.test(value.slice(start, end))) {
        commandDraft.current = { start, end, value }
        dirty.current = true
        completion.update(field)
        return
      }
    }
    commandDraft.current = null
    completion.dismiss()
    dirty.current = commitOnBlur
    if (!commitOnBlur) commit(plainText(field.innerText.replace(/\r/g, '')))
  }
  return <><span ref={element} {...completion.aria} className={`visual-editable ${className}`} data-source-start={span.start} data-source-end={span.end} contentEditable={editing} suppressContentEditableWarning spellCheck={false} role="textbox" aria-label={onDeleteEmpty ? t("编辑空行，按退格或删除键移除空行") : t("编辑文本")} onClick={event => {
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
  }} onFocus={() => { dirty.current = false; onFocus?.() }} onBlur={event => {
    if (dirty.current) commit(plainText(event.currentTarget.innerText.replace(/\r/g, '')))
    commandDraft.current = null
    dirty.current = false
    completion.dismiss()
    setEditing(false)
    onBlur?.()
  }} onInput={event => {
    const input = event.nativeEvent as InputEvent
    if (!composing.current && !input.isComposing) handleInput(event.currentTarget, input.inputType === 'insertText' ? input.data : null)
  }} onCompositionStart={() => { composing.current = true; completion.dismiss() }}
    onCompositionEnd={event => { composing.current = false; handleInput(event.currentTarget) }}
    onSelect={event => completion.onSelect(event.currentTarget)}
    onKeyDown={event => {
    if (composing.current || completion.onKeyDown(event)) return
    if (!onDeleteEmpty || (event.key !== 'Backspace' && event.key !== 'Delete') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const field = readProseField(event.currentTarget)
    if (!field || field.value.trim()) return
    event.preventDefault()
    dirty.current = false
    onDeleteEmpty()
  }} />{completion.menu}</>
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
  const workspace = useContext(VisualCompletion)
  const container = useRef<HTMLSpanElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const completion = useSourceCompletion(span, draft, setDraft)
  const original = useRef(value)
  const cancelled = useRef(false)
  const fromProse = useRef(false)
  const requestedSelection = useRef<SourceSpan | null>(null)
  const clickStart = useRef<{ x: number; y: number } | null>(null)
  const save = () => {
    if (!cancelled.current && draft !== original.current) onEdit(span, original.current, draft)
    cancelled.current = false
    original.current = draft
    setEditing(false)
  }
  const open = () => { cancelled.current = false; original.current = value; setDraft(value); setEditing(true) }
  useLayoutEffect(() => {
    const field = container.current
    if (!field) return
    focusVisualField.set(field, selection => {
      requestedSelection.current = selection
      fromProse.current = true
      open()
    })
    const input = field.querySelector('textarea')
    const selection = requestedSelection.current
    if (input && selection) {
      input.setSelectionRange(selection.start - span.start, selection.end - span.start)
      requestedSelection.current = null
    }
    return () => { focusVisualField.delete(field) }
  })
  const resumeProse = (next: string) => {
    if (!workspace || !fromProse.current) return
    const source = workspace.source.slice(0, span.start) + next + workspace.source.slice(span.end)
    const after = selectionSpan.end + next.length - value.length
    fromProse.current = false
    workspace.resume({ source, selection: { start: after, end: after }, after })
  }
  const livePreview = previewValue && previewValue !== value && value ? previewValue.replace(value, () => draft) : draft
  return <span ref={container} className={`visual-math ${display ? 'display' : ''}`} data-source-start={selectionSpan.start} data-source-end={selectionSpan.end} data-source-atomic="true"
    data-formula-start={span.start} data-formula-end={span.end}>
    {editing ? <span className="visual-math-input">
      <MathPreview value={livePreview} display={display} />
      <textarea {...completion.fieldProps} autoFocus aria-label={t("编辑公式源码")} rows={display ? 3 : 1} value={draft}
        onBlur={() => { completion.dismiss(); save(); fromProse.current = false }}
        onKeyDown={event => {
          if (completion.onKeyDown(event)) return
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelled.current = true
            setEditing(false)
            resumeProse(value)
          }
          if (event.key === 'Enter' && ((fromProse.current && !event.shiftKey) || event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            resumeProse(draft)
            event.currentTarget.blur()
          }
        }}
      />
      {completion.menu}
    </span> : <><span className="visual-math-click-target" title={t("点击编辑公式")} onPointerDown={event => { clickStart.current = { x: event.clientX, y: event.clientY } }} onClick={event => { const start = clickStart.current; clickStart.current = null; if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) open() }}><MathPreview value={previewValue ?? value} display={display} /></span><button type="button" aria-label={t("编辑公式")} title={t("编辑公式源码")} onClick={open}><Pencil size={13} /></button></>}
  </span>
}

function SourceEditor({ block, onEdit, onClose }: { block: VisualBlock; onEdit: Edit; onClose: () => void }) {
  const [draft, setDraft] = useState(block.raw)
  const completion = useSourceCompletion(block, draft, setDraft)
  const apply = () => { if (draft !== block.raw) onEdit(block, block.raw, draft); onClose() }
  return <div className="visual-source-editor">
    <textarea {...completion.fieldProps} autoFocus aria-label={t("原位编辑源码")} spellCheck={false} value={draft}
      onBlur={completion.dismiss}
      onKeyDown={event => {
        if (completion.onKeyDown(event)) return
        if (event.key === 'Escape') { event.preventDefault(); onClose() }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply() }
      }}
    />
    {completion.menu}
    <div><button type="button" onClick={onClose}>{t("取消")}</button><button type="button" onClick={apply}>{t("应用源码")}</button></div>
  </div>
}

function SourceBlock({ block, onEdit }: { block: VisualBlock; onEdit: Edit }) {
  const [open, setOpen] = useState(false)
  return <div className="visual-source-block" data-block-start={block.start} data-block-end={block.end}><button type="button" className="visual-source-summary" aria-expanded={open} onClick={() => setOpen(!open)}><Code2 size={15} /><span>{block.summary || t("源码块")}</span><small>{open ? t("收起") : t("展开源码")}</small></button>{open && <SourceEditor block={block} onEdit={onEdit} onClose={() => setOpen(false)} />}</div>
}

function AlgorithmBlock({ block, onEdit, children }: { block: VisualBlock; onEdit: Edit; children: ReactNode }) {
  const [sourceOpen, setSourceOpen] = useState(false)
  return <section className="visual-algorithm" data-block-start={block.start} data-block-end={block.end}>
    <div className="visual-algorithm-head"><span>{t("算法思考")}</span><strong>{block.name}</strong><button type="button" onClick={() => setSourceOpen(value => !value)}><Code2 size={13} />{sourceOpen ? t("收起源码") : t("查看源码")}</button></div>
    <div className="visual-algorithm-body">{children}</div>
    {sourceOpen && <SourceEditor block={block} onEdit={onEdit} onClose={() => setSourceOpen(false)} />}
  </section>
}

function MediaCard({ block, projectId, source, assetPath, draftIncluded, onToggleDraft, onEdit, onCompile, onReview, onFocus, onBlur }: { block: VisualBlock; projectId: string; source: string; assetPath: (name: string) => string; draftIncluded: boolean; onToggleDraft: (block: VisualBlock) => void; onEdit: Edit; onCompile: (block: VisualBlock) => Promise<string>; onReview: (block: VisualBlock) => void; onFocus: () => void; onBlur: () => void }) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(() => block.kind === 'table' && Boolean(block.tableCells?.length))
  const [pdfUrl, setPdfUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setPdfUrl(''); setError('') }, [block.raw])
  const title = block.kind === 'figure' ? t("图片") : t("表格")
  const draftSupported = !/^\s*\\begin\{(?:longtable|tabular\*?|tabularx|center)\}/.test(block.raw) && !(block.labels?.length && !block.caption)
  const preview = () => { setPreviewOpen(value => !value) }
  const compile = async () => {
    setBusy(true); setError('')
    try { setPdfUrl(await onCompile(block)); setPreviewOpen(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="visual-media-card" data-block-start={block.start} data-block-end={block.end}>
    <div className="visual-media-head">{block.kind === 'figure' ? <ImageIcon size={17} /> : <Table2 size={17} />}<strong>{title}</strong><span>{block.assets?.[0] ?? t("{0} 行", block.rows?.length ?? 0)}</span></div>
    {block.captionChildren?.length ? <div className="visual-media-caption" aria-label={block.kind === 'figure' ? t("完整图注") : t("完整表注")}>{block.captionChildren.map((node, index) => <Inline key={index} node={node} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption />)}</div> : <div className="visual-media-caption empty">{block.kind === 'figure' ? t("暂无图注") : t("暂无表注")}</div>}
    <div className="visual-media-actions"><button type="button" onClick={preview}>{previewOpen ? t("收起预览") : t("查看预览")}</button><button type="button" onClick={() => setSourceOpen(value => !value)}><Code2 size={13} />{sourceOpen ? t("收起源码") : t("查看源码")}</button><button type="button" onClick={() => onReview(block)}>{t("评论")}</button>{draftSupported ? <label className="visual-draft-toggle"><input type="checkbox" checked={draftIncluded} onChange={() => onToggleDraft(block)} />{t("纳入草稿 PDF")}</label> : <span className="visual-draft-toggle">{t("此结构始终完整编译")}</span>}<button type="button" disabled={busy} onClick={() => void compile()}><Play size={12} />{busy ? t("编译中…") : t("编译此卡片")}</button></div>
    {previewOpen && <div className={`visual-media-preview ${pdfUrl ? 'compiled' : ''}`}>{pdfUrl ? <CardPdfPreview url={pdfUrl} /> : block.kind === 'figure' && block.assets?.length ? block.assets.map(name => { const resolved = assetPath(name); return /\.(png|jpe?g)$/i.test(resolved) ? <img key={name} loading="lazy" alt={title} src={`/api/projects/${encodeURIComponent(projectId)}/asset?path=${encodeURIComponent(resolved)}`} /> : <div key={name} className="visual-media-placeholder">{name}{" " + t("· 点击编译查看排版")}</div> }) : block.tableCells?.length ? <><small className="visual-table-hint">{t("结构预览 · 精确排版以 PDF 为准")}</small><table><tbody>{block.tableCells.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell.children.map((node, nodeIndex) => <Inline key={nodeIndex} node={node} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption />)}</td>)}</tr>)}</tbody></table></> : <div className="visual-media-placeholder">{t("复杂图表需编译后查看排版")}</div>}</div>}
    {!previewOpen && <div className="visual-media-placeholder">{t("预览尚未加载 · 按需打开以减少长文档资源占用")}</div>}
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

type InlineProps = { node: InlineNode; source: string; onEdit: Edit; onFocus: () => void; onBlur: () => void; caption?: boolean }

function Inline(props: InlineProps) {
  const offset = useContext(VisualCompletion)?.continuationOffset
  return <>{renderInlineNode(props)}{offset === props.node.end && <span data-continuation-anchor={offset} />}</>
}

function ReferenceToken({ node, source, onEdit, onFocus, onBlur }: InlineProps) {
  const workspace = useContext(VisualCompletion)
  const { kind, value } = node
  if (!value || (kind !== 'reference' && kind !== 'citation')) return null
  const keys = source.slice(value.start, value.end)
  return <span className={`visual-token ${kind}`} title={node.raw + t("Ctrl/⌘ + 点击跳转到定义")}
    onMouseDownCapture={event => {
      if (event.button === 0 && (event.ctrlKey || event.metaKey)) event.preventDefault()
    }}
    onClickCapture={event => {
      if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      event.stopPropagation()
      const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY)
      const field = event.currentTarget.querySelector('.visual-editable')
      const offset = caret && field?.contains(caret.startContainer) ? caret.startOffset : 0
      const key = keys.split(',')[keys.slice(0, offset).split(',').length - 1]?.trim()
      if (!key) return
      window.getSelection()?.removeAllRanges()
      workspace?.navigateReference(kind, key)
    }}>
    <span>{kind === 'reference' ? '↗' : '❝'}</span>
    <Editable span={value} raw={keys} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />
  </span>
}

function renderInlineNode({ node, source, onEdit, onFocus, onBlur, caption = false }: InlineProps) {
  if (node.kind === 'text') return <Editable span={node} raw={node.raw} prose onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />
  if (node.kind === 'bold' || node.kind === 'italic') {
    const children = node.children?.map((child, index) => <Inline key={index} node={child} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption={caption} />)
    return node.kind === 'bold' ? <strong className="visual-format">{children}</strong> : <em className="visual-format">{children}</em>
  }
  if (node.kind === 'highlight') return <mark className="visual-inline-highlight" style={{ backgroundColor: highlightCss(node.name) }}>{node.children?.map((child, index) => <Inline key={index} node={child} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption={caption} />)}</mark>
  if (node.kind === 'math' && node.value) return <MathEditor span={node.value} selectionSpan={node} value={source.slice(node.value.start, node.value.end)} display={Boolean(node.display)} onEdit={onEdit} />
  if (node.kind === 'reference' || node.kind === 'citation') return <ReferenceToken node={node} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />
  if (node.kind === 'link') return <span className="visual-link" title={node.raw}>↗ {node.children?.length ? node.children.map((child, index) => <Inline key={index} node={child} source={source} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} caption={caption} />) : node.label && <Editable span={node.label} raw={source.slice(node.label.start, node.label.end)} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />}{node.target && node.label !== node.target && <Editable className="visual-link-target" span={node.target} raw={source.slice(node.target.start, node.target.end)} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} />}</span>
  return caption ? <span className="visual-caption-fallback" title={t("可在查看源码中精确修改")}>{readableCaptionCommand(node.raw)}</span> : <code className="visual-inline-source" title={t("复杂命令：在 Code 模式或源码块中编辑")}>{node.raw}</code>
}

function findViewportBlock(container: HTMLElement, y: number): HTMLElement | undefined {
  // Each body flows vertically, so only the block crossing y can contain the anchor.
  const blocks = container.children
  let first = 0
  let last = blocks.length
  while (first < last) {
    const mid = (first + last) >>> 1
    if (blocks[mid].getBoundingClientRect().bottom <= y) first = mid + 1
    else last = mid
  }
  for (let index = first; index < blocks.length; index++) {
    const block = blocks[index] as HTMLElement
    if (block.dataset.blockStart === undefined) continue
    const body = block.querySelector<HTMLElement>(':scope > .visual-structured-body, :scope > .visual-algorithm-body')
    return (body && body.getBoundingClientRect().top <= y ? findViewportBlock(body, y) : undefined) ?? block
  }
}

export function VisualEditor({ source, completionContext, projectId, file, assetPath, draftCards, onToggleDraft, onEdit, onCompileCard, onReviewCard, onUndo, onRedo, onShortcut, onFocus, onBlur, onSelection, onViewport, onNavigateReference, target }: { source: string; completionContext: CompletionContext; projectId: string; file: string; assetPath: (name: string) => string; draftCards: string[]; onToggleDraft: (block: VisualBlock) => void; onEdit: Edit; onCompileCard: (block: VisualBlock) => Promise<string>; onReviewCard: (block: VisualBlock) => void; onUndo: () => void; onRedo: () => void; onShortcut: (command: 'save' | 'bold' | 'italic') => void; onFocus: () => void; onBlur: () => void; onSelection: (span: SourceSpan) => void; onViewport: (offset: number) => void; onNavigateReference: NavigateReference; target: { offset: number; serial: number } | null }) {
  const document = useMemo(() => parseVisualLatex(source), [source])
  const blankBlocks = useMemo(() => {
    const result: VisualBlock[] = []
    const visit = (blocks: VisualBlock[]) => { for (const block of blocks) { if (block.kind === 'blank') result.push(block); if (block.body) visit(block.body) } }
    visit(document.blocks)
    return result
  }, [document])
  const root = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const [resume, setResume] = useState<ResumeEdit | null>(null)
  const [continuation, setContinuation] = useState<{ request: ResumeEdit; host: HTMLElement | null } | null>(null)
  const resumed = useRef<ResumeEdit | null>(null)
  const queuedResume = useRef<ResumeEdit | null>(null)
  const requestResume = (request: ResumeEdit) => {
    queuedResume.current = request
    setResume(request)
  }
  const continuationHere = continuation?.request === resume && resume.source === source ? continuation : null
  useLayoutEffect(() => {
    const host = root.current
    if (!host || !resume || resume.source !== source || resumed.current === resume) return
    const fields = [...host.querySelectorAll<HTMLElement>('.visual-editable, [data-formula-start]')]
    const findField = (selection: SourceSpan, includeFormula: boolean) => {
      const matches = fields.filter(field => {
        const formula = field.dataset.formulaStart !== undefined
        if (formula && !includeFormula) return false
        const start = Number(formula ? field.dataset.formulaStart : field.dataset.sourceStart)
        const end = Number(formula ? field.dataset.formulaEnd : field.dataset.sourceEnd)
        return start <= selection.start && selection.end <= end
      })
      // At a shared boundary, continue in the text after the inserted command.
      return matches.find(field => Number(field.dataset.sourceStart) === selection.start) ?? matches[0]
    }
    let selection = resume.selection
    let field = findField(selection, selection.start !== selection.end)
    if (!field) {
      selection = { start: resume.after, end: resume.after }
      field = findField(selection, false)
    }
    const focus = field && focusVisualField.get(field)
    if (focus) {
      resumed.current = resume
      focus(selection)
      onSelection(selection)
      return
    }
    if (!continuationHere) {
      setContinuation({ request: resume, host: null })
      return
    }
    if (continuationHere.host) return
    const inlineAnchor = host.querySelector<HTMLElement>('[data-continuation-anchor]')
    const blocks = [...host.querySelectorAll<HTMLElement>('[data-block-start][data-block-end]')]
    const block = blocks
      .filter(item => Number(item.dataset.blockStart) < resume.after && resume.after <= Number(item.dataset.blockEnd))
      .sort((a, b) => Number(b.dataset.blockStart) - Number(a.dataset.blockStart))[0]
    const anchor = inlineAnchor ?? block ?? host.querySelector<HTMLElement>('.visual-page')
    if (anchor) setContinuation({ request: resume, host: anchor })
  }, [source, resume, continuation, onSelection])
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
    if (!host?.clientHeight || !page.current) return
    const top = host.getBoundingClientRect().top + 70
    const block = findViewportBlock(page.current, top)
    if (!block) return
    if (block.matches('.visual-structured, .visual-algorithm')) {
      onViewport(Number(block.dataset.blockStart))
      return
    }
    const editableSelector = '[data-source-start]:not([data-source-atomic])'
    for (const editable of block.querySelectorAll<HTMLElement>(editableSelector)) {
      const rect = editable.getBoundingClientRect()
      if (rect.bottom <= top) continue
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
    onViewport(Number(block.dataset.blockStart))
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
      if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error(t("无效的可视化选区"))
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
  const selectedEditable = () => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return null
    const range = selection.getRangeAt(0)
    const editable = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.visual-editable')
    const first = editable(range.startContainer)
    return first && first === editable(range.endContainer) && first.isContentEditable ? first : null
  }
  const clipboardSelection = () => {
    const selection = window.getSelection()
    const span = selectedSourceSpan()
    return selection && !selection.isCollapsed && span && span.end > span.start ? span : null
  }
  const writeClipboard = (event: React.ClipboardEvent<HTMLDivElement>, remove: boolean) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || selectedEditable()) return
    const span = clipboardSelection()
    if (!span) return
    const latex = source.slice(span.start, span.end)
    event.clipboardData.setData('text/plain', window.getSelection()?.toString() || latex)
    event.clipboardData.setData('application/x-texloom-latex', latex)
    event.preventDefault()
    if (remove) {
      window.getSelection()?.removeAllRanges()
      onEdit(span, latex, '')
      onSelection({ start: span.start, end: span.start })
    }
  }
  useEffect(() => {
    const deleteSelection = (event: KeyboardEvent) => {
      if ((event.key !== 'Backspace' && event.key !== 'Delete') || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return
      const selection = window.getSelection()
      const host = root.current
      if (!selection?.rangeCount || !host) return
      const range = selection.getRangeAt(0)
      if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return
      const target = event.target
      if (!(target instanceof Node) || !host.contains(target)) return
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return
      if (selection.isCollapsed) {
        const editable = (target instanceof Element ? target : target.parentElement)?.closest<HTMLElement>('.visual-editable')
        // Blank lines handle their own deletion. Their DOM may already contain a draft.
        if (!editable?.isContentEditable || editable.classList.contains('visual-blank-editable')) return
        const field = readProseField(editable)
        const backwards = event.key === 'Backspace'
        if (!field || field.caret !== (backwards ? 0 : field.value.length)) return
        const start = Number(editable.dataset.sourceStart)
        const end = Number(editable.dataset.sourceEnd)
        const storedText = decodeText(source.slice(start, end)).replace(/\r/g, '')
        if (field.value !== storedText) return
        const boundary = backwards ? start : end
        const blank = adjacentBlank(blankBlocks, source, boundary, backwards ? 'before' : 'after')
        if (!blank) return
        event.preventDefault()
        event.stopPropagation()
        onEdit(blank, blank.raw, '')
        const offset = backwards ? boundary - blank.raw.length : boundary
        onSelection({ start: offset, end: offset })
        return
      }
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
  }, [source, blankBlocks, onEdit, onSelection])
  const renderBlock = (block: VisualBlock, index: number): ReactNode => {
    if (block.kind === 'blank' && block.content) return <div key={index} className="visual-blank-line" data-block-start={block.start} data-block-end={block.end}><Editable className="visual-blank-editable" span={block.content} raw={source.slice(block.content.start, block.content.end)} prose commitOnBlur onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} onDeleteEmpty={() => onEdit(block, block.raw, '')} /></div>
    if (block.kind === 'source') return <SourceBlock key={`${index}-source`} block={block} onEdit={onEdit} />
    if (block.kind === 'algorithm') return <AlgorithmBlock key={index} block={block} onEdit={onEdit}>{block.body?.map(renderBlock)}</AlgorithmBlock>
    if (block.kind === 'figure' || block.kind === 'table') return <MediaCard key={draftCardKey(file, block, source)} block={block} projectId={projectId} source={source} assetPath={assetPath} draftIncluded={draftCards.includes(draftCardKey(file, block, source))} onToggleDraft={onToggleDraft} onEdit={onEdit} onCompile={onCompileCard} onReview={onReviewCard} onFocus={onFocus} onBlur={onBlur} />
    if (block.kind === 'title') return <header key={index} className="visual-title" data-block-start={block.start} data-block-end={block.end}>{block.title ? <h1>{renderInline(block.children)}</h1> : <span>{t("标题")}</span>}{block.author && <div className="visual-title-author"><Editable span={block.author} raw={source.slice(block.author.start, block.author.end)} prose onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} /></div>}{block.date && <div className="visual-title-date"><Editable span={block.date} raw={source.slice(block.date.start, block.date.end)} prose onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} /></div>}</header>
    if (block.kind === 'abstract' || block.kind === 'theorem') return <section key={index} className={`visual-structured ${block.kind} visual-${block.name}`} data-block-start={block.start} data-block-end={block.end}><div className="visual-structured-title">{block.kind === 'abstract' ? t("摘要") : ({ proof: t("证明"), proposition: t("命题"), theorem: t("定理"), lemma: t("引理"), corollary: t("推论"), definition: t("定义"), remark: t("说明"), example: t("例") } as Record<string, string>)[block.name ?? ''] ?? block.name}{block.summary && <span>（{block.summary}）</span>}</div><div className="visual-structured-body">{block.body?.map(renderBlock)}</div></section>
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
  return <div ref={root} className="visual-editor" tabIndex={-1} onCopyCapture={event => writeClipboard(event, false)} onCutCapture={event => writeClipboard(event, true)} onPasteCapture={event => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
    const latex = event.clipboardData.getData('application/x-texloom-latex')
    const span = latex ? selectedSourceSpan() : clipboardSelection()
    if (!span || (!latex && selectedEditable())) return
    const text = latex || encodeText(event.clipboardData.getData('text/plain').replace(/\r\n/g, '\n'))
    if (!text) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    onEdit(span, source.slice(span.start, span.end), text)
    onSelection({ start: span.start + text.length, end: span.start + text.length })
  }} onScroll={() => { if (scrollFrame.current) return; scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = 0; reportViewport() }) }} onPointerDownCapture={event => {
    if (!event.currentTarget.contains(event.target as Node)) return
    const active = window.document.activeElement
    if (active instanceof HTMLElement && active.classList.contains('visual-editable') && root.current?.contains(active)) {
      active.contentEditable = 'false'
      active.blur()
    }
  }} onPointerUp={event => { const block = (event.target as HTMLElement).closest<HTMLElement>('[data-block-start]'); queueMicrotask(() => { if (!captureSelection() && block) onSelection({ start: Number(block.dataset.blockStart), end: Number(block.dataset.blockStart) }); const selection = window.getSelection(); if (selection && !selection.isCollapsed && root.current && !root.current.contains(window.document.activeElement)) root.current.focus({ preventScroll: true }) }) }} onKeyUp={captureSelection} onFocusCapture={() => queueMicrotask(captureSelection)} onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['s', 'b', 'i'].includes(event.key.toLowerCase())) { event.preventDefault(); captureSelection(); onShortcut(({ s: 'save', b: 'bold', i: 'italic' } as const)[event.key.toLowerCase() as 's' | 'b' | 'i']); return }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.target as HTMLElement).blur(); onUndo() }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); (event.target as HTMLElement).blur(); onRedo() }
  }}>
    <VisualCompletion.Provider value={{ source, context: completionContext, resume: requestResume, continuationOffset: continuationHere?.request.after, navigateReference: onNavigateReference, crlf: source.includes('\r\n') }}>
      <div className="visual-page" ref={page}>{!document.documentFound && <p className="visual-warning">{t("未找到完整文档结构，当前以源码块显示。")}</p>}{document.blocks.map(renderBlock)}</div>
      {continuationHere?.host && createPortal(
        <Editable className="visual-continuation" span={{ start: continuationHere.request.after, end: continuationHere.request.after }} raw="" prose
          onFocus={onFocus}
          onBlur={() => { setContinuation(old => old?.request === continuationHere.request ? null : old); onBlur() }}
          onEdit={(span, expected, replacement) => {
            const updated = source.slice(0, span.start) + replacement + source.slice(span.end)
            if (queuedResume.current?.source !== updated) {
              const after = span.start + replacement.length
              requestResume({ source: updated, selection: { start: after, end: after }, after })
            }
            onEdit(span, expected, replacement)
          }}
        />, continuationHere.host)}
    </VisualCompletion.Provider>
  </div>
}
