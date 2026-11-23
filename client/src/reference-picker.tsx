import { t } from './i18n'
import { useMemo, useState } from 'react'
import { referenceLatex, type CitationItem, type ReferenceItem, type ReferenceKind } from './reference-index'
import './reference-picker.css'

export type ReferenceChoice = ReferenceItem | CitationItem

const names: Record<ReferenceKind | 'citation', string> = {
  get figure() { return t("图片") }, get table() { return t("表格") }, get equation() { return t("公式") }, get section() { return t("章节") }, get other() { return t("其他") }, get citation() { return t("文献") },
}
const categories = ['all', 'figure', 'table', 'equation', 'section', 'citation', 'other'] as const

export function ReferencePicker({ mode, references, citations, selected, manualKey, onSelect, onManual, onRefresh }: {
  mode: 'reference' | 'citation'; references: ReferenceItem[]; citations: CitationItem[]
  selected: ReferenceChoice | null; manualKey: string; onSelect: (choice: ReferenceChoice) => void
  onManual: (value: string) => void; onRefresh: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof categories)[number]>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const items = useMemo(() => mode === 'citation' ? citations : [...references, ...citations], [mode, references, citations])
  const shown = useMemo(() => items.filter(item => {
    const kind = 'source' in item ? 'citation' : item.kind
    if (category !== 'all' && kind !== category) return false
    const needle = query.trim().toLocaleLowerCase()
    return !needle || [item.value, item.file, item.title, 'detail' in item ? item.detail : '', names[kind]].join(' ').toLocaleLowerCase().includes(needle)
  }).slice(0, 150), [items, category, query])
  const refresh = async () => {
    setRefreshing(true); setRefreshError('')
    try { await onRefresh() }
    catch (error) { setRefreshError(error instanceof Error ? error.message : String(error)) }
    finally { setRefreshing(false) }
  }
  return <div className="reference-picker">
    <div className="reference-search"><input autoFocus aria-label={t("搜索引用键")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("搜索键、标题、作者或文件…")} /><button type="button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? t("更新中…") : t("更新列表")}</button></div>
    {mode === 'reference' && <div className="reference-categories" aria-label={t("引用分类")}>{categories.map(kind => {
      const count = kind === 'all' ? items.length : items.filter(item => ('source' in item ? 'citation' : item.kind) === kind).length
      if (kind !== 'all' && !count) return null
      return <button type="button" key={kind} className={category === kind ? 'active' : ''} aria-pressed={category === kind} onClick={() => setCategory(kind)}>{kind === 'all' ? t("全部") : names[kind]} <span>{count}</span></button>
    })}</div>}
    {mode === 'citation' && <p className="reference-count">{t("项目文献") + " "}{items.length}{" " + t("条 · 来源：")}<code>thebibliography</code>{" " + t("和") + " "}<code>.bib</code></p>}
    <div className="reference-options" role="listbox" aria-label={mode === 'citation' ? t("文献键列表") : t("交叉引用列表")}>
      {shown.length ? shown.map(item => {
        const kind = 'source' in item ? 'citation' : item.kind
        const active = selected?.value === item.value && selected?.file === item.file
        return <button type="button" role="option" aria-selected={active} className={active ? 'selected' : ''} key={`${item.file}:${item.value}:${kind}`} onClick={() => onSelect(item)}>
          <span className="reference-option-top"><span className="reference-badge">{names[kind]}</span><strong>{item.value}</strong></span>
          {item.title && <span className="reference-option-title">{item.title}</span>}
          <span className="reference-option-meta">{item.file}{'detail' in item && item.detail ? ` · ${t(item.detail)}` : ''}</span>
        </button>
      }) : <div className="reference-empty">{items.length ? t("没有匹配的引用") : mode === 'citation' ? t("尚未找到文献键，请添加 \\bibitem 或 .bib 条目") : t("尚未找到标签或文献键")}</div>}
    </div>
    {items.length > shown.length && <p className="reference-count">{t("当前显示前 {0} 条，请搜索缩小范围。", shown.length)}</p>}
    <label className="reference-manual">{t("手动输入键（可选）")}<input value={manualKey} onChange={event => onManual(event.target.value)} placeholder={mode === 'citation' ? t("例如 Smith2024") : t("例如 fig:example")} /></label>
    {selected && !manualKey.trim() && <p className="reference-insert-preview">{t("将插入") + " "}<code>{referenceLatex(selected)}</code></p>}
    {refreshError && <p className="reference-refresh-error" role="alert">{refreshError}</p>}
  </div>
}
