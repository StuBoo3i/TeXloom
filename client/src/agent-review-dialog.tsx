import { t } from './i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { agentApi, type AgentChange } from './agent-types'
import { latexLanguageId, latexThemeName } from './latex-language'
import type { ThemeId } from './appearance'
import { lineHunks } from '../../shared/agent-hunks'
import { agentReviewVersion, type AgentResolution } from '../../shared/agent-review'
import './agent-review-dialog.css'

type ReviewChange = AgentChange & { conflict: boolean; currentHash?: string | null; current?: string; currentSize?: number }
type Side = 'before' | 'current' | 'after'
type Preview = { path: string; before: string; after: string; current?: string }
const sideLabels: Record<Side, string> = { get before() { return t("创建草稿时") }, get current() { return t("当前项目") }, get after() { return t("Agent 草稿") } }
const comparisons = [
  { get label() { return t("当前版本的改动") }, left: 'before', right: 'current' },
  { get label() { return t("Agent 的改动") }, left: 'before', right: 'after' },
  { get label() { return t("当前与 Agent 对比") }, left: 'current', right: 'after' },
] as const
const kindLabels = { get created() { return t("新增") }, get modified() { return t("修改") }, get deleted() { return t("删除") } } as const
const imageFile = (path: string) => /\.(png|jpe?g|gif|webp)$/i.test(path)
const formatSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`

const versionHash = (change: ReviewChange, side: Side) => {
  if (side === 'current' && change.currentHash === undefined) return undefined
  return (side === 'current' ? change.currentHash : side === 'before' ? change.beforeHash : change.afterHash) ?? 'missing'
}
const versionQuery = (change: ReviewChange, side: Side) => {
  const query = new URLSearchParams({ path: change.path, side })
  const hash = versionHash(change, side)
  if (hash !== undefined) query.set('hash', hash)
  return query
}

function DraftImage({ projectId, change, side }: { projectId: string; change: ReviewChange; side: Side }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    void fetch('/api/projects/' + projectId + '/agent/asset?' + versionQuery(change, side), { headers: { 'X-TeXloom-Agent': '1' } })
      .then(response => response.ok ? response.blob() : Promise.reject(new Error(t("预览加载失败"))))
      .then(blob => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) } })
      .catch(() => { if (!cancelled) setUrl('') })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [projectId, change, side])
  return url ? <img src={url} alt={sideLabels[side] + '：' + change.path} /> : <span>{t("图片预览加载中或不可用")}</span>
}

function TextDiff({ change, preview, left, right, theme }: { change: ReviewChange; preview: Preview; left: Side; right: Side; theme: string }) {
  const diff = useRef<editor.IStandaloneDiffEditor | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const differentBytes = versionHash(change, left) !== versionHash(change, right)
  useLayoutEffect(() => () => {
    const instance = diff.current
    const model = instance?.getModel()
    // Detach both models before Monaco's React wrapper disposes the editor.
    instance?.setModel(null)
    model?.original.dispose()
    model?.modified.dispose()
    diff.current = null
  }, [])
  return <>
    <div className="agent-review-diff-tools">
      <div className="agent-review-diff-nav">
        <span aria-live="polite">{count === null ? t("计算差异中…") : count ? count + t("处差异") : differentBytes ? t("没有可显示的行差异，请核对文件状态及换行") : t("内容相同")}</span>
        <button type="button" disabled={!count} onClick={() => diff.current?.goToDiff('previous')}>{t("上一处")}</button>
        <button type="button" disabled={!count} onClick={() => diff.current?.goToDiff('next')}>{t("下一处")}</button>
      </div>
      <div className="agent-review-diff-sides">
        {[left, right].map(side => <span key={side}>{sideLabels[side]}{versionHash(change, side) === 'missing' ? t("（文件不存在）") : ''}</span>)}
      </div>
    </div>
    <div className="agent-review-diff">
      <DiffEditor height="100%" language={/\.(tex|sty|cls)$/i.test(change.path) ? latexLanguageId : 'plaintext'}
        theme={theme} original={preview[left] ?? ''} modified={preview[right] ?? ''}
        options={{
          readOnly: true, originalEditable: false, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false, minimap: { enabled: false },
          scrollBeyondLastLine: false, automaticLayout: true,
          ...(change.conflict ? { ignoreTrimWhitespace: false, hideUnchangedRegions: { enabled: true } } : {}),
        }}
        onMount={instance => {
          diff.current = instance
          let initialized = false
          const update = () => {
            const ranges = instance.getLineChanges()
            if (!ranges) return
            setCount(ranges.length)
            if (change.conflict && ranges.length && !initialized) {
              initialized = true
              const start = Math.max(1, ranges[0].modifiedStartLineNumber)
              instance.getModifiedEditor().setPosition({ lineNumber: start, column: 1 })
              instance.getModifiedEditor().revealLineInCenter(start)
            }
          }
          instance.onDidUpdateDiff(update)
          update()
        }}
      />
    </div>
  </>
}

type ReviewProps = {
  projectId: string
  onClose: () => void
  onApplied: (paths: string[]) => void
  onRefresh: () => Promise<void>
  onBeforeApply: () => Promise<boolean>
}

export function AgentReviewDialog({ projectId, onClose, onApplied, onRefresh, onBeforeApply }: ReviewProps) {
  const [changes, setChanges] = useState<ReviewChange[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [active, setActive] = useState('')
  const [previews, setPreview] = useState<Preview | null>(null)
  const [choices, setChoices] = useState<Record<string, AgentResolution>>({})
  const [comparison, setComparison] = useState(0)
  const [hunkSelections, setHunkSelections] = useState<Record<string, number[]>>({})
  const [canResolve, setCanResolve] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function load() {
    setLoading(true)
    try {
      const result = await agentApi<{ agentReviewVersion?: number; changes: ReviewChange[] }>('/api/projects/' + projectId + '/agent/review')
      setCanResolve(result.agentReviewVersion === agentReviewVersion)
      setChanges(result.changes)
      setPreview(null)
      setSelected(result.changes.filter(change => !change.conflict).map(change => change.path))
      setChoices({})
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
  const preview = previews?.path === active ? previews : null
  const hunks = current?.kind === 'modified' && !current.conflict && preview ? lineHunks(preview.before, preview.after) : null
  const selectedHunks = current && hunks ? hunkSelections[current.path] ?? hunks.map(hunk => hunk.index) : []
  useEffect(() => {
    if (!current || current.binary) { setPreview(null); return }
    if (current.before !== undefined && current.after !== undefined && (!current.conflict || current.current !== undefined || current.currentHash === null)) {
      setPreview({ path: current.path, before: current.before, after: current.after, current: current.current })
      return
    }
    let cancelled = false
    setPreview(null)
    const get = async (side: Side) => (await agentApi<{ content: string }>('/api/projects/' + projectId + '/agent/preview?' + versionQuery(current, side))).content
    void Promise.all([get('before'), get('after'), ...(current.conflict ? [get('current')] : [])]).then(parts => {
      if (!cancelled) setPreview({ path: current.path, before: parts[0], after: parts[1], ...(current.conflict ? { current: parts[2] } : {}) })
    }).catch(issue => { if (!cancelled) setError(String(issue)) })
    return () => { cancelled = true }
  }, [projectId, current])
  const conflicts = changes.filter(change => change.conflict)
  const unresolved = conflicts.filter(change => !Object.hasOwn(choices, change.path))
  const selectedConflicts = conflicts.filter(change => selected.includes(change.path))
  const blocked = selectedConflicts.some(change => !canResolve || !Object.hasOwn(choices, change.path))
  function chooseVersions(files: ReviewChange[], choice: AgentResolution['choice']) {
    if (!canResolve || files.some(change => change.currentHash === undefined)) return
    const resolutions = files.map(change => [change.path, {
      choice, currentHash: change.currentHash ?? null, beforeHash: change.beforeHash ?? null, afterHash: change.afterHash ?? null,
    }] as const)
    setChoices(old => ({ ...old, ...Object.fromEntries(resolutions) }))
    setSelected(old => [...new Set([...old, ...files.map(change => change.path)])])
  }
  async function apply() {
    if (!selected.length || blocked || loading) return
    setBusy(true); setError('')
    try {
      if (!(await onBeforeApply())) { setError(t("当前编辑尚未保存，保存后再应用审阅结果")); return }
      const chosenHunks = Object.fromEntries(Object.entries(hunkSelections).filter(([path]) => selected.includes(path)))
      const resolutions = Object.fromEntries(Object.entries(choices).filter(([path]) => selected.includes(path)))
      const result = await agentApi<{ applied: string[]; remaining: number }>(`/api/projects/${projectId}/agent/apply`, 'POST', { paths: selected, hunks: chosenHunks, resolutions })
      if (result.applied.length) onApplied(result.applied)
      await onRefresh()
      if (result.remaining) await load()
      else onClose()
    } catch (issue) { await load(); setError(String(issue)) }
    finally { setBusy(false) }
  }
  async function discard() {
    if (!window.confirm(t("放弃此项目全部未采纳的 Agent 草稿修改？"))) return
    setBusy(true); setError('')
    try { await agentApi(`/api/projects/${projectId}/agent/discard`, 'POST'); await onRefresh(); onClose() }
    catch (issue) { setError(String(issue)) }
    finally { setBusy(false) }
  }
  const theme = latexThemeName((document.documentElement.dataset.theme || 'academic') as ThemeId)
  return createPortal(<div className="agent-review-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="agent-review-dialog" role="dialog" aria-modal="true" aria-label={t("审阅 Agent 草稿")}>
      <header>
        <h2>{t("审阅 Agent 草稿")}</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label={t("关闭审阅")}>×</button>
      </header>
      <div className="agent-review-body">
        <aside className="agent-review-files" aria-label={t("变更文件")}>
          <div className="agent-review-file-heading"><strong>{t("变更文件")}</strong><span>{changes.length}</span></div>
          {!loading && canResolve && conflicts.length > 1 && <div className="agent-review-bulk">
            <strong>{t("全部") + " "}{conflicts.length}{" " + t("个冲突文件")}</strong>
            <button type="button" disabled={busy} onClick={() => chooseVersions(conflicts, 'current')}>{t("全部保留当前版本")}</button>
            <button type="button" disabled={busy} onClick={() => chooseVersions(conflicts, 'draft')}>{t("全部采用 Agent 版本")}</button>
          </div>}
          {loading ? <p>{t("读取差异中…")}</p> : changes.map(change => (
            <div className={'agent-review-file ' + (active === change.path ? 'active' : '')} key={change.path}>
              <input type="checkbox" aria-label={t("纳入本次应用") + change.path} checked={selected.includes(change.path)}
                disabled={busy || (change.conflict && !Object.hasOwn(choices, change.path))}
                onChange={event => {
                  setSelected(old => event.target.checked ? [...old, change.path] : old.filter(path => path !== change.path))
                  if (event.target.checked) setHunkSelections(old => { const next = { ...old }; delete next[change.path]; return next })
                }} />
              <button type="button" onClick={() => { setActive(change.path); setComparison(0) }}>
                <span>{kindLabels[change.kind]} · {change.path}</span>
                {change.conflict && <em>{!Object.hasOwn(choices, change.path) ? t("待选版本") : choices[change.path].choice === 'current' ? t("保留当前版本") : t("应用 Agent 版本")}</em>}
              </button>
            </div>
          ))}
        </aside>
        <div className="agent-review-detail">
          {current ? <>
            <div className="agent-review-meta">
              <strong>{current.path}</strong>
              <span>{t("当前") + " "}{current.currentHash === null ? t("无文件") : formatSize(current.currentSize ?? current.beforeSize)}{" " + t("→ 草稿") + " "}{current.afterHash ? formatSize(current.afterSize) : t("无文件")}</span>
            </div>
            {current.conflict && !canResolve && !loading && <p className="agent-review-error" role="alert">{t("当前后端还没有版本统一功能。请重启 TeXloom 后端，再点「刷新差异」。") + " "}<button type="button" onClick={() => void load()}>{t("刷新差异")}</button></p>}
            {current.conflict && <fieldset className="agent-review-resolution" aria-label={t("选择要统一使用的版本")} disabled={busy || loading || !canResolve} key={current.path}>
              <div className="agent-review-resolution-heading">
                <strong>{t("保留哪个版本？")}</strong>
                <span>{t("确认后会统一原项目、草稿和基线")}</span>
              </div>
              <div className="agent-review-resolution-options">
                {(['current', 'draft'] as const).map(choice => {
                  const checked = Object.hasOwn(choices, current.path) && choices[current.path].choice === choice
                  return <label key={choice} data-chosen={checked}>
                    <input type="radio" name={'agent-resolution-' + current.path} checked={checked} onChange={() => chooseVersions([current], choice)} />
                    <span><strong>{choice === 'current' ? t("保留当前版本") : t("采用 Agent 版本")}</strong>
                      <small>{choice === 'current' ? t("舍弃此文件的草稿改动") : current.afterHash ? t("替换当前文件，保留应用前快照") : t("删除当前文件，保留应用前快照")}</small>
                    </span>
                  </label>
                })}
              </div>
            </fieldset>}
            {current.binary ? <div className={'agent-review-images ' + (current.conflict ? 'agent-review-images-conflict' : '')}>
              {(current.conflict ? ['before', 'current', 'after'] as const : ['before', 'after'] as const).map(side => (
                <div key={side}>
                  <strong>{sideLabels[side]}</strong>
                  {versionHash(current, side) === 'missing' ? <p>{t("无文件")}</p> :
                    imageFile(current.path) ? <DraftImage projectId={projectId} change={current} side={side} /> : <p>{t("二进制文件")}</p>}
                </div>
              ))}
            </div> : preview ? current.conflict ? <>
              <div className="agent-review-comparisons" aria-label={t("选择对照版本")}>
                {comparisons.map((item, index) => (
                  <button type="button" aria-pressed={comparison === index} key={item.label} onClick={() => setComparison(index)}>{item.label}</button>
                ))}
              </div>
              <TextDiff key={current.path + ':' + comparison} change={current} preview={preview}
                left={comparisons[comparison].left} right={comparisons[comparison].right} theme={theme} />
            </> : <div className="agent-review-text">
              {hunks?.length ? <div className="agent-review-hunks">
                <strong>{t("按段采纳 ·") + " "}{selectedHunks.length}/{hunks.length}</strong>
                {hunks.map(hunk => <label key={hunk.index}>
                  <input type="checkbox" disabled={busy} checked={selectedHunks.includes(hunk.index)} onChange={event => {
                    const next = event.target.checked ? [...selectedHunks, hunk.index] : selectedHunks.filter(index => index !== hunk.index)
                    setHunkSelections(old => ({ ...old, [current.path]: next }))
                    setSelected(old => next.length ? old.includes(current.path) ? old : [...old, current.path] : old.filter(path => path !== current.path))
                  }} />
                  <span>{t("片段 {0} · 原文第 {1} 行", hunk.index + 1, hunk.beforeStart + 1)}<small>{(hunk.after || t("（删除）")).trim().slice(0, 55)}</small></span>
                </label>)}
              </div> : null}
              <div className="agent-review-single-diff">
                <TextDiff key={current.path} change={current} preview={preview} left="before" right="after" theme={theme} />
              </div>
            </div> : <p>{error ? t("无法显示此版本的文本对照") : t("加载文本对照中…")}</p>}
          </> : <p>{t("选择左侧文件查看差异")}</p>}
        </div>
      </div>
      {error && <p className="agent-review-error" role="alert">{error} <button type="button" disabled={busy || loading} onClick={() => void load()}>{t("刷新差异")}</button></p>}
      <footer>
        <span>{selected.length} / {changes.length}{" " + t("个文件待处理")}{unresolved.length ? ' · ' + unresolved.length + t("个冲突待选版本") : ''}</span>
        <button type="button" onClick={() => void discard()} disabled={busy || loading || !changes.length}>{t("放弃全部草稿")}</button>
        <button type="button" onClick={onClose} disabled={busy}>{t("继续完善")}</button>
        <button type="button" className="primary" onClick={() => void apply()} disabled={busy || loading || !selected.length || blocked}>
          {selectedConflicts.length ? t("应用并统一版本") : t("应用所选并同步")}
        </button>
      </footer>
    </section>
  </div>, document.body)
}
