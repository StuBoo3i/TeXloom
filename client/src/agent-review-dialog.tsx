import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { DiffEditor } from '@monaco-editor/react'
import { agentApi, type AgentChange } from './agent-types'
import { latexLanguageId, latexThemeName } from './latex-language'
import type { ThemeId } from './appearance'
import { lineHunks } from '../../shared/agent-hunks'
import './agent-review-dialog.css'

type ReviewChange = AgentChange & { conflict: boolean; current?: string; currentSize?: number }
const kindLabels = { created: '新增', modified: '修改', deleted: '删除' } as const
const imageFile = (path: string) => /\.(png|jpe?g|gif|webp)$/i.test(path)
const formatSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`

function DraftImage({ projectId, path, side }: { projectId: string; path: string; side: 'before' | 'after' | 'current' }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    void fetch(`/api/projects/${projectId}/agent/asset?path=${encodeURIComponent(path)}&side=${side}`, { headers: { 'X-TeXloom-Agent': '1' } })
      .then(response => response.ok ? response.blob() : Promise.reject(new Error('预览加载失败')))
      .then(blob => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) } })
      .catch(() => { if (!cancelled) setUrl('') })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [projectId, path, side])
  return url ? <img src={url} alt={`${side === 'before' ? '创建草稿时' : side === 'current' ? '当前原项目' : '草稿图片'}：${path}`} /> : <span>图片预览加载中或不可用</span>
}

export function AgentReviewDialog({ projectId, onClose, onApplied, onRefresh }: { projectId: string; onClose: () => void; onApplied: (paths: string[]) => void; onRefresh: () => Promise<void> }) {
  const [changes, setChanges] = useState<ReviewChange[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [active, setActive] = useState('')
  const [preview, setPreview] = useState<{ before: string; after: string; current?: string } | null>(null)
  const [hunkSelections, setHunkSelections] = useState<Record<string, number[]>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function load() {
    setLoading(true)
    try {
      const result = await agentApi<{ changes: ReviewChange[] }>(`/api/projects/${projectId}/agent/review`)
      setChanges(result.changes)
      setPreview(null)
      setSelected(result.changes.map(change => change.path))
      setHunkSelections({})
      setActive(previous => result.changes.some(change => change.path === previous) ? previous : result.changes[0]?.path || '')
      setError('')
    } catch (issue) { setError(String(issue)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [projectId])
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [busy, onClose])
  const current = changes.find(change => change.path === active)
  const hunks = current?.kind === 'modified' && !current.conflict && preview ? lineHunks(preview.before, preview.after) : null
  const selectedHunks = current && hunks ? hunkSelections[current.path] ?? hunks.map(hunk => hunk.index) : []
  useEffect(() => {
    if (!current || current.binary) { setPreview(null); return }
    if (current.before !== undefined && current.after !== undefined && (!current.conflict || current.current !== undefined)) {
      setPreview({ before: current.before, after: current.after, current: current.current })
      return
    }
    let cancelled = false
    setPreview(null)
    const get = async (side: 'before' | 'after' | 'current') => (await agentApi<{ content: string }>(`/api/projects/${projectId}/agent/preview?path=${encodeURIComponent(current.path)}&side=${side}`)).content
    void Promise.all([get('before'), get('after'), ...(current.conflict ? [get('current')] : [])]).then(parts => {
      if (!cancelled) setPreview({ before: parts[0], after: parts[1], ...(current.conflict ? { current: parts[2] } : {}) })
    }).catch(issue => { if (!cancelled) setError(String(issue)) })
    return () => { cancelled = true }
  }, [projectId, current])
  const conflicts = changes.filter(change => selected.includes(change.path) && change.conflict)
  async function apply() {
    if (!selected.length || conflicts.length) return
    setBusy(true); setError('')
    try {
      const chosenHunks = Object.fromEntries(Object.entries(hunkSelections).filter(([path]) => selected.includes(path)))
      const result = await agentApi<{ applied: string[]; remaining: number }>(`/api/projects/${projectId}/agent/apply`, 'POST', { paths: selected, hunks: chosenHunks })
      onApplied(result.applied)
      await onRefresh()
      if (result.remaining) await load()
      else onClose()
    } catch (issue) { await load(); setError(String(issue)) }
    finally { setBusy(false) }
  }
  async function discard() {
    if (!window.confirm('放弃此项目全部未采纳的 Agent 草稿修改？')) return
    setBusy(true); setError('')
    try { await agentApi(`/api/projects/${projectId}/agent/discard`, 'POST'); await onRefresh(); onClose() }
    catch (issue) { setError(String(issue)) }
    finally { setBusy(false) }
  }
  const theme = latexThemeName((document.documentElement.dataset.theme || 'academic') as ThemeId)
  return createPortal(<div className="agent-review-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="agent-review-dialog" role="dialog" aria-modal="true" aria-label="审阅 Agent 草稿">
      <header><div><strong>审阅 Agent 草稿</strong><small>草稿独立保存 · 选择文件后应用</small></div><button type="button" onClick={onClose} disabled={busy} aria-label="关闭审阅">×</button></header>
      <div className="agent-review-body">
        <aside className="agent-review-files" aria-label="变更文件">{loading ? <p>读取差异中…</p> : changes.map(change => <div className={`agent-review-file ${active === change.path ? 'active' : ''}`} key={change.path}><input type="checkbox" aria-label={`采纳 ${change.path}`} checked={selected.includes(change.path)} onChange={event => { setSelected(old => event.target.checked ? [...old, change.path] : old.filter(path => path !== change.path)); if (event.target.checked) setHunkSelections(old => { const next = { ...old }; delete next[change.path]; return next }) }} /><button type="button" onClick={() => setActive(change.path)}><span>{kindLabels[change.kind]} · {change.path}</span>{change.conflict && <em>冲突</em>}</button></div>)}</aside>
        <div className="agent-review-detail">{current ? <><div className="agent-review-meta"><strong>{current.path}</strong><span>{kindLabels[current.kind]} · 原文件 {formatSize(current.beforeSize)} → 草稿 {formatSize(current.afterSize)}</span></div>{current.conflict && <p className="agent-review-conflict">原项目在草稿创建后发生了变化。请先核对冲突；当前文件不会被覆盖。</p>}{current.binary ? <div className="agent-review-images">{(['before', 'after'] as const).map(side => <div key={side}><strong>{side === 'before' ? '原文件' : '草稿文件'}</strong>{(side === 'before' ? current.beforeHash : current.afterHash) ? imageFile(current.path) ? <DraftImage projectId={projectId} path={current.path} side={side} /> : <p>二进制文件 · {formatSize(side === 'before' ? current.beforeSize : current.afterSize)}</p> : <p>无文件</p>}</div>)}</div> : current.conflict ? <div className="agent-review-three">{[['创建草稿时', preview?.before], ['当前原项目', preview?.current], ['Agent 草稿', preview?.after]].map(([label, value]) => <div key={label}><strong>{label}</strong><pre>{value ?? '加载中…'}</pre></div>)}</div> : preview ? <div className="agent-review-text">{hunks?.length ? <div className="agent-review-hunks"><strong>按段采纳 · {selectedHunks.length}/{hunks.length}</strong>{hunks.map(hunk => <label key={hunk.index}><input type="checkbox" checked={selectedHunks.includes(hunk.index)} onChange={event => { const next = event.target.checked ? [...selectedHunks, hunk.index] : selectedHunks.filter(index => index !== hunk.index); setHunkSelections(old => ({ ...old, [current.path]: next })); setSelected(old => next.length ? old.includes(current.path) ? old : [...old, current.path] : old.filter(path => path !== current.path)) }} /><span>片段 {hunk.index + 1} · 原文第 {hunk.beforeStart + 1} 行<small>{(hunk.after || '（删除）').trim().slice(0, 55)}</small></span></label>)}</div> : null}<div className="agent-review-diff"><DiffEditor key={current.path} height="100%" language={/\.(tex|sty|cls)$/i.test(current.path) ? latexLanguageId : 'plaintext'} theme={theme} original={preview.before} modified={preview.after} options={{ readOnly: true, originalEditable: false, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true }} /></div></div> : <p>加载文本对照中…</p>}</> : <p>选择左侧文件查看差异。</p>}</div>
      </div>
      {error && <p className="agent-review-error" role="alert">{error}</p>}
      <footer><span>{selected.length} / {changes.length} 个文件待应用{conflicts.length ? ` · ${conflicts.length} 个冲突` : ''}</span><button type="button" onClick={() => void discard()} disabled={busy || !changes.length}>放弃全部草稿</button><button type="button" onClick={onClose} disabled={busy}>继续完善</button><button type="button" className="primary" onClick={() => void apply()} disabled={busy || !selected.length || !!conflicts.length}>应用所选并同步</button></footer>
    </section>
  </div>, document.body)
}
