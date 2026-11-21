import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CloudUpload, Code2, Columns2, Download, ExternalLink, File, FilePlus2, FileText, Folder, FolderOpen, GitBranch, Home, LoaderCircle, Maximize2, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Play, Plus, RefreshCw, Save, Search, Settings2, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Dashboard } from './dashboard'
import { Landing } from './landing'
import { WorkspaceRootDialog, type WorkspaceInfo } from './workspace-root'
import type { AiSettingsInput } from './ai-service-settings'
import { EditorToolbar, WorkspaceMenuBar, WorkspaceSidebar, type AiOutputView, type AiSettingsView, type GitState, type PanelId, type ReviewThread, type Snapshot } from './workspace-ui'
import { InsertDialog, type ImageSource, type InsertKind } from './insert-dialog'
import { ReviewDialog, type ReviewDraft } from './review-dialog'
import { AiDiffDialog } from './ai-diff-dialog'
import { headingLine, listLatex, newAssetPath } from './latex-edit'
import { buildOutline, isSearchableFile, replaceSource, searchSources, type OutlineEntry, type SearchHit, type SearchOptions } from './project-analysis'
import { applyAppearance, fontFamilies, readAppearance, saveAppearance, type Appearance } from './appearance'
import { latexLanguageId, latexThemeName, registerLatexLanguage } from './latex-language'
import { registerLatexCompletion, type CompletionContext } from './latex-completion'
import { buildReferenceIndex, type IndexedSource } from './reference-index'
import { VisualEditor } from './visual-editor'
import { highlightColors } from './highlight'
import { draftCardKey, replaceSourceSpan, type SourceSpan, type VisualBlock } from './visual-latex'
import './styles.css'
import './preview.css'
import './layout.css'
import './shortcuts.css'
import './appearance.css'
import './focus-mode.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
applyAppearance(readAppearance())

type Project = { id: string; name: string; mainFile: string; createdAt: string; updatedAt: string; sharing?: 'personal' | 'shared'; archived?: boolean; tags?: string[] }
type FileEntry = { path: string; type: 'file' | 'directory'; size?: number }
type Job = { id: string; projectId: string; status: 'running' | 'success' | 'error'; log: string; startedAt: string; finishedAt?: string; mode?: 'full' | 'draft' }
type Layout = 'split' | 'editor' | 'pdf'
type SyncPoint = { file: string; line: number; page: number; x: number; y: number; kind: 'text' | 'box' }
type PdfTarget = { page: number; x: number; y: number; serial: number }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || `请求失败 (${response.status})`)
  }
  return response.json() as Promise<T>
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function PdfPreview({ projectId, version, mode = 'full', target, onReverse }: { projectId: string; version: number; mode?: 'full' | 'draft'; target?: PdfTarget | null; onReverse?: (page: number, x: number, y: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [stageWidth, setStageWidth] = useState(500)
  const [rendered, setRendered] = useState({ page: 0, scale: 1 })
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setPdf(null)
    setError('')
    const task = pdfjsLib.getDocument({ url: `/api/projects/${projectId}/pdf?mode=${mode}&v=${version}`, withCredentials: false })
    task.promise.then(doc => { if (!cancelled) { setPdf(doc); setPage(1) } }).catch(() => { if (!cancelled) setError('尚无 PDF，点击“编译”生成预览。') })
    return () => { cancelled = true; void task.destroy() }
  }, [projectId, version, mode])

  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(entries => setStageWidth(entries[0]?.contentRect.width ?? 500))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pdf || !canvas.current) return
    let cancelled = false
    let renderTask: ReturnType<pdfjsLib.PDFPageProxy['render']> | undefined
    void pdf.getPage(page).then(pdfPage => {
      if (cancelled || !canvas.current) return
      const naturalWidth = pdfPage.getViewport({ scale: 1 }).width
      const fitScale = Math.min(1.38, Math.max(.2, (stageWidth - 48) / naturalWidth))
      const viewport = pdfPage.getViewport({ scale: fitScale * zoom })
      const element = canvas.current
      const ctx = element.getContext('2d')
      if (!ctx) return
      setRendered({ page, scale: viewport.scale })
      element.width = viewport.width
      element.height = viewport.height
      renderTask = pdfPage.render({ canvasContext: ctx, viewport, canvas: element })
      void renderTask.promise.catch(() => {})
    })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, page, zoom, stageWidth])

  useEffect(() => {
    if (pdf && target && target.page >= 1 && target.page <= pdf.numPages) setPage(target.page)
  }, [pdf, target?.serial])

  useEffect(() => {
    if (!target || target.page !== rendered.page || !stage.current) return
    const container = stage.current
    const left = target.x * rendered.scale
    const top = target.y * rendered.scale
    container.scrollTop = Math.max(0, top - container.clientHeight / 2)
    container.scrollLeft = Math.max(0, left - container.clientWidth / 2)
  }, [target?.serial, rendered])

  function reverseAt(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!onReverse || rendered.page !== page) return
    const rect = event.currentTarget.getBoundingClientRect()
    onReverse(page, (event.clientX - rect.left) / rendered.scale, (event.clientY - rect.top) / rendered.scale)
  }

  return <section className="preview-pane">
    <div className="pane-title"><div className="pane-title-label"><FileText size={17} /><strong>PDF 预览</strong><span className="pane-subtitle">{mode === 'draft' ? '草稿 · 图表占位' : '完整编译结果'}</span></div><a className="icon-button" aria-label="下载 PDF" title="下载 PDF" href={`/api/projects/${projectId}/pdf?mode=${mode}&v=${version}`} download={mode === 'draft' ? 'draft.pdf' : 'document.pdf'}><Download size={17} /></a></div>
    <div className="pdf-toolbar"><div className="page-control"><button onClick={() => setPage(Math.max(1, page - 1))} disabled={!pdf || page <= 1} aria-label="上一页"><ChevronLeft size={16} /></button><span>{pdf ? `${page} / ${pdf.numPages}` : '— / —'}</span><button onClick={() => setPage(Math.min(pdf?.numPages ?? 1, page + 1))} disabled={!pdf || page >= pdf.numPages} aria-label="下一页"><ChevronRight size={16} /></button></div><div className="zoom-control"><button onClick={() => setZoom(Math.max(.6, +(zoom - .1).toFixed(1)))} aria-label="缩小"><ZoomOut size={16} /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(Math.min(2, +(zoom + .1).toFixed(1)))} aria-label="放大"><ZoomIn size={16} /></button></div>{onReverse && <span className="pdf-sync-hint">双击页面定位源码</span>}</div>
    <div ref={stage} className="pdf-stage">{pdf ? <div className="pdf-page-wrap"><canvas ref={canvas} className={`pdf-page ${onReverse ? 'reverse-enabled' : ''}`} title={onReverse ? '双击定位到源码' : undefined} onDoubleClick={reverseAt} />{target && rendered.page === target.page && <span key={target.serial} className="pdf-sync-marker" style={{ left: target.x * rendered.scale, top: target.y * rendered.scale }} />}</div> : <div className="pdf-empty"><div className="pdf-empty-icon"><FileText size={34} strokeWidth={1.5} /></div><strong>预览将在这里显示</strong><p>{error || '正在载入 PDF…'}</p></div>}</div>
  </section>
}

function LayoutPicker({ layout, onChoose, onOpenTab }: { layout: Layout; onChoose: (layout: Layout) => void; onOpenTab: () => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false) }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [open])
  const choose = (next: Layout) => { onChoose(next); setOpen(false) }
  return <div className="layout-picker" ref={menuRef}>
    <button className={`layout-trigger ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}><Columns2 size={16} />布局<ChevronDown size={14} /></button>
    {open && <div className="layout-menu" role="menu" aria-label="布局选项">
      <div className="layout-menu-title">布局选项</div>
      <button role="menuitemradio" aria-checked={layout === 'split'} className={layout === 'split' ? 'selected' : ''} onClick={() => choose('split')}><Columns2 size={18} />拆分视图{layout === 'split' && <Check className="layout-check" size={17} />}</button>
      <button role="menuitemradio" aria-checked={layout === 'editor'} className={layout === 'editor' ? 'selected' : ''} onClick={() => choose('editor')}><Code2 size={18} />仅编辑器{layout === 'editor' && <Check className="layout-check" size={17} />}</button>
      <button role="menuitemradio" aria-checked={layout === 'pdf'} className={layout === 'pdf' ? 'selected' : ''} onClick={() => choose('pdf')}><FileText size={18} />仅 PDF{layout === 'pdf' && <Check className="layout-check" size={17} />}</button>
      <div className="layout-menu-divider" />
      <button role="menuitem" onClick={() => { onOpenTab(); setOpen(false) }}><ExternalLink size={18} />在单独的选项卡中打开 PDF</button>
    </div>}
  </div>
}

function App({ onExit }: { onExit: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [rootDialog, setRootDialog] = useState<'create' | 'change' | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [activePath, setActivePath] = useState('')
  const [content, setContent] = useState('')
  const [editorMode, setEditorMode] = useState<'code' | 'visual'>('code')
  const [visualTarget, setVisualTarget] = useState<{ offset: number; serial: number } | null>(null)
  const [visualLine, setVisualLine] = useState(1)
  const [highlightColor, setHighlightColor] = useState(() => {
    const saved = localStorage.getItem('texloom:highlight-color')
    return highlightColors.find(color => color.latex === saved)?.latex ?? highlightColors[0].latex
  })
  const [savedContent, setSavedContent] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [pdfVersion, setPdfVersion] = useState(0)
  const [pdfMode, setPdfMode] = useState<'full' | 'draft'>('full')
  const [draftCards, setDraftCards] = useState<string[]>([])
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [focusMode, setFocusMode] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(230, Math.min(500, Number(localStorage.getItem('texloom:sidebar-width')) || 308)))
  const dragStart = useRef<{ x: number; y: number; size: number } | null>(null)
  const [activePanel, setActivePanel] = useState<PanelId | null>('files')
  const [modal, setModal] = useState<'project' | 'file' | 'clone' | null>(null)
  const [modalValue, setModalValue] = useState('')
  const [modalBusy, setModalBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoCompile, setAutoCompile] = useState(true)
  const [appearance, setAppearance] = useState(readAppearance)
  const [editorFontSize, setEditorFontSize] = useState(() => {
    const stored = Number(localStorage.getItem('openleaf:editor-font-size'))
    return stored >= 11 && stored <= 24 ? stored : 14
  })
  const [editorWrap, setEditorWrap] = useState<'on' | 'off'>(() => localStorage.getItem('openleaf:editor-wrap') === 'off' ? 'off' : 'on')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [layout, setLayout] = useState<Layout>('split')
  const [splitPercent, setSplitPercent] = useState(50)
  const [tectonicReady, setTectonicReady] = useState(false)
  const [insertDialog, setInsertDialog] = useState<{ kind: InsertKind; source?: ImageSource; symbolGroup?: number; tableMode?: 'size' | 'text' | 'image' } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [insertSources, setInsertSources] = useState<{ projectId: string; files: IndexedSource[] }>({ projectId: '', files: [] })
  const insertIndexSerial = useRef(0)
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [reviewThreads, setReviewThreads] = useState<ReviewThread[]>([])
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [gitState, setGitState] = useState<GitState | null>(null)
  const [gitFeedback, setGitFeedback] = useState<{ action: 'push' | 'pull'; status: 'running' | 'success' | 'error'; message: string } | null>(null)
  const [aiSettings, setAiSettings] = useState<AiSettingsView>({ provider: 'deepseek', configured: false, model: 'deepseek-chat', maxOutputTokens: 2048, timeoutSeconds: 90, profiles: { deepseek: { configured: false, model: 'deepseek-chat', maxOutputTokens: 2048, timeoutSeconds: 90 }, volcano: { configured: false, model: '', maxOutputTokens: 2048, timeoutSeconds: 90 }, aliyun: { configured: false, model: 'qwen-plus', maxOutputTokens: 2048, timeoutSeconds: 90 }, openai: { configured: false, model: 'gpt-4.1-mini', maxOutputTokens: 2048, timeoutSeconds: 90 }, anthropic: { configured: false, model: 'claude-sonnet-4-5', maxOutputTokens: 2048, timeoutSeconds: 90 } } })
  const [aiOutput, setAiOutput] = useState<AiOutputView>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiDiffOpen, setAiDiffOpen] = useState(false)
  const aiTarget = useRef<{ path: string; selection: Monaco.Selection; original: string } | null>(null)
  const aiController = useRef<AbortController | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const visualSelectionRef = useRef<SourceSpan | null>(null)
  const visualViewportOffsetRef = useRef(0)
  const visualTargetSerialRef = useRef(0)
  useEffect(() => { visualSelectionRef.current = null }, [editorMode, activePath, project?.id])
  const storedInsertIndex = React.useMemo(() => buildReferenceIndex(insertSources.projectId === project?.id ? insertSources.files.filter(item => item.file !== activePath) : []), [insertSources, project?.id, activePath])
  const activeInsertIndex = React.useMemo(() => buildReferenceIndex(activePath ? [{ file: activePath, source: content }] : []), [activePath, content])
  const references = React.useMemo(() => [...activeInsertIndex.references, ...storedInsertIndex.references.filter(item => !activeInsertIndex.references.some(active => active.value === item.value))], [activeInsertIndex, storedInsertIndex])
  const citations = React.useMemo(() => [...activeInsertIndex.citations, ...storedInsertIndex.citations.filter(item => !activeInsertIndex.citations.some(active => active.value === item.value))], [activeInsertIndex, storedInsertIndex])
  const completionContext = useRef<CompletionContext>({ references: [], citations: [], files: [] })
  completionContext.current = {
    references,
    citations,
    files,
  }
  const splitRef = useRef<HTMLDivElement>(null)
  const pendingSelection = useRef<{ path: string; selection: Monaco.Selection } | null>(null)
  const commandRef = useRef<(command: string) => void>(() => {})
  const uploadRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const workspaceBadgeRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef<Promise<boolean> | null>(null)
  const autoCompileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = job?.status === 'running'
  const dirty = content !== savedContent

  useEffect(() => { setFocusMode(false) }, [project?.id])
  useEffect(() => {
    if (!focusMode) return
    const exitFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof HTMLElement && event.target.closest('.visual-math-input,.visual-source-editor,[role="dialog"]')) return
      event.preventDefault()
      setFocusMode(false)
      if (editorMode === 'visual') requestAnimationFrame(() => setVisualTarget({ offset: visualViewportOffsetRef.current, serial: ++visualTargetSerialRef.current }))
    }
    window.addEventListener('keydown', exitFocus)
    return () => window.removeEventListener('keydown', exitFocus)
  }, [focusMode, editorMode])

  const showError = (error: unknown) => { setNotice(error instanceof Error ? error.message : String(error)); setTimeout(() => setNotice(''), 5500) }
  const refreshProjects = async () => setProjects(await api<Project[]>('/api/projects'))
  const refreshWorkspace = async (projectId?: string) => {
    const info = await api<WorkspaceInfo>(`/api/workspace${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`)
    setWorkspaceInfo(info)
    return info
  }
  async function beginNewProject() {
    try {
      const info = await refreshWorkspace()
      if (!info.configured) setRootDialog('create')
      else { setModal('project'); setModalValue('') }
    } catch (error) { showError(error) }
  }
  const refreshFiles = async (id: string) => {
    const list = await api<FileEntry[]>(`/api/projects/${id}/files`)
    setFiles(list)
    return list
  }

  useEffect(() => {
    void refreshProjects().catch(showError)
    void refreshWorkspace().catch(showError)
    void api<{ tectonic: boolean }>('/api/health').then(data => setTectonicReady(data.tectonic)).catch(showError)
    void api<AiSettingsView>('/api/ai/settings').then(setAiSettings).catch(showError)
  }, [])

  useEffect(() => { void refreshWorkspace(project?.id).catch(showError) }, [project?.id])
  useEffect(() => {
    if (!project) { setDraftCards([]); return }
    try { const saved = JSON.parse(localStorage.getItem(`texloom:draft-cards:${project.id}`) || '[]'); setDraftCards(Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : []) }
    catch { setDraftCards([]) }
  }, [project?.id])
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!workspaceBadgeRef.current?.contains(event.target as Node)) setWorkspaceOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  useEffect(() => {
    if (!project || !activePath || !dirty) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveCurrent() }, 900)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [content, savedContent, activePath, project?.id])

  useEffect(() => () => {
    if (autoCompileTimer.current) clearTimeout(autoCompileTimer.current)
  }, [project?.id])

  useEffect(() => {
    if (!project) { setOutline([]); return }
    let cancelled = false
    const projectId = project.id
    const mainFile = project.mainFile
    const texFiles = files.filter(file => file.type === 'file' && file.path.endsWith('.tex')).slice(0, 100)
    void Promise.allSettled(texFiles.map(async file => ({ path: file.path, content: (await api<{ content: string }>(`/api/projects/${projectId}/file?path=${encodeURIComponent(file.path)}`)).content }))).then(results => {
      if (cancelled) return
      const sources = new Map(results.filter((result): result is PromiseFulfilledResult<{ path: string; content: string }> => result.status === 'fulfilled').map(result => [result.value.path, result.value.content]))
      setOutline(buildOutline(sources, mainFile))
    })
    return () => { cancelled = true }
  }, [project?.id, project?.mainFile, files])

  const insertIndexFiles = files.filter(file => file.type === 'file' && /\.(tex|bib)$/i.test(file.path)).map(file => file.path).join('\u0000')
  useEffect(() => {
    if (!project) { setInsertSources({ projectId: '', files: [] }); return }
    void loadInsertIndex().catch(showError)
  }, [project?.id, activePath, insertIndexFiles])

  useEffect(() => {
    if (!project) return
    void api<ReviewThread[]>(`/api/projects/${project.id}/review`).then(setReviewThreads).catch(showError)
    void api<Snapshot[]>(`/api/projects/${project.id}/history`).then(setSnapshots).catch(showError)
  }, [project?.id])

  useEffect(() => {
    if (!project || activePanel !== 'integrations') return
    void api<GitState>(`/api/projects/${project.id}/git`).then(setGitState).catch(showError)
  }, [project?.id, activePanel])

  useEffect(() => {
    if (!project || !job || job.status !== 'running') return
    const timer = setInterval(async () => {
      try {
        const next = await api<Job>(`/api/projects/${project.id}/jobs/${job.id}`)
        setJob(next)
        if (next.status === 'success') { setPdfTarget(null); setPdfMode(next.mode === 'draft' ? 'draft' : 'full'); setPdfVersion(Date.now()); setShowLogs(false); void refreshProjects() }
        if (next.status === 'error') setShowLogs(true)
      } catch (error) { showError(error) }
    }, 700)
    return () => clearInterval(timer)
  }, [job?.id, job?.status, project?.id])

  async function saveCurrent(scheduleCompile = true): Promise<boolean> {
    if (!project || !activePath) return true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const previous = saveInFlight.current
    const source = editorMode === 'visual' && activePath.endsWith('.tex') ? editorRef.current?.getModel()?.getValue() ?? content : content
    if (source === savedContent && !previous) return true
    const projectId = project.id
    const path = activePath
    setSaving(true)
    const current = (async () => {
      if (previous) await previous
      try {
        await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`, json('PUT', { content: source }))
        setSavedContent(source)
        await refreshFiles(projectId)
        if (scheduleCompile && autoCompile && !busy) {
          if (autoCompileTimer.current) clearTimeout(autoCompileTimer.current)
          autoCompileTimer.current = setTimeout(() => { void startCompile(projectId) }, 1200)
        }
        return true
      } catch (error) { showError(error); return false }
    })()
    saveInFlight.current = current
    try {
      return await current
    } finally {
      if (saveInFlight.current === current) {
        saveInFlight.current = null
        setSaving(false)
      }
    }
  }

  async function openFile(id: string, file: string) {
    try {
      if (project && activePath && !(await saveCurrent(false))) return
      const data = await api<{ content: string }>(`/api/projects/${id}/file?path=${encodeURIComponent(file)}`)
      visualSelectionRef.current = null
      setActivePath(file)
      setContent(data.content)
      setSavedContent(data.content)
    } catch (error) { showError(error) }
  }

  async function openProject(item: Project) {
    try {
      if (project && activePath && !(await saveCurrent(false))) return
      setProject(item)
      setReviewThreads([]); setSnapshots([]); setGitState(null); setGitFeedback(null); setSearchHits([]); setAiOutput(null)
      setJob(null)
      setPdfMode('full')
      setPdfVersion(Date.now())
      const projectFiles = await refreshFiles(item.id)
      const mainSize = projectFiles.find(file => file.path === item.mainFile)?.size ?? 0
      const storedAutoCompile = localStorage.getItem(`openleaf:auto-compile:${item.id}`)
      setAutoCompile(storedAutoCompile === null ? mainSize < 100_000 : storedAutoCompile === 'true')
      const storedLayout = localStorage.getItem(`openleaf:layout:${item.id}`)
      setLayout(storedLayout === 'editor' || storedLayout === 'pdf' ? storedLayout : 'split')
      const storedSplit = Number(localStorage.getItem(`texloom:split:${item.id}`))
      setSplitPercent(storedSplit >= 20 && storedSplit <= 80 ? storedSplit : 50)
      setPdfTarget(null)
      await openFile(item.id, item.mainFile)
    } catch (error) { showError(error) }
  }

  async function submitModal() {
    if (modalBusy) return
    setModalBusy(true)
    try {
      if (modal === 'project') {
        const item = await api<Project>('/api/projects', json('POST', { name: modalValue }))
        await refreshProjects()
        await openProject(item)
      } else if (modal === 'clone') {
        await api('/api/git/connect', json('POST', { url: modalValue.trim() }))
        const item = await api<Project>('/api/projects/clone', json('POST', { url: modalValue.trim() }))
        await refreshProjects()
        await openProject(item)
      } else if (modal === 'file' && project) {
        const file = modalValue.trim()
        await api(`/api/projects/${project.id}/file?path=${encodeURIComponent(file)}`, json('PUT', { content: file.endsWith('.tex') ? '% 新建 LaTeX 文件\n' : '' }))
        await refreshFiles(project.id)
        await openFile(project.id, file)
      }
      setModal(null); setModalValue('')
    } catch (error) { showError(error) }
    finally { setModalBusy(false) }
  }

  async function compile() {
    if (!project || busy) return
    try {
      if (autoCompileTimer.current) clearTimeout(autoCompileTimer.current)
      if (!(await saveCurrent(false))) return
      await startCompile(project.id, 'full')
    } catch (error) { showError(error) }
  }

  async function compileDraft() {
    if (!project || busy) return
    try {
      if (autoCompileTimer.current) clearTimeout(autoCompileTimer.current)
      if (!(await saveCurrent(false))) return
      await startCompile(project.id, 'draft', draftCards)
    } catch (error) { showError(error) }
  }

  async function startCompile(id: string, mode: 'full' | 'draft' = 'full', includeCards: string[] = []) {
    try {
      const next = await api<Job>(`/api/projects/${id}/compile`, json('POST', { mode, includeCards }))
      setJob(next)
      setShowLogs(true)
    } catch (error) { showError(error) }
  }

  async function upload(file: File) {
    if (!project) return
    try {
      const form = new FormData(); form.append('file', file)
      await api(`/api/projects/${project.id}/upload?path=${encodeURIComponent(file.name)}`, { method: 'POST', body: form })
      await refreshFiles(project.id)
    } catch (error) { showError(error) }
  }

  async function importZip(file: File) {
    try {
      const form = new FormData(); form.append('file', file)
      const item = await api<Project>('/api/import', { method: 'POST', body: form })
      await refreshProjects(); await openProject(item)
    } catch (error) { showError(error) }
  }

  async function deleteProject() {
    if (!project || !window.confirm(`确定删除“${project.name}”及其全部文件吗？此操作无法撤销。`)) return
    try { await api(`/api/projects/${project.id}`, { method: 'DELETE' }); setProject(null); setActivePath(''); await refreshProjects() }
    catch (error) { showError(error) }
  }

  async function deleteFile(file: string) {
    if (!project || !window.confirm(`确定删除 ${file} 吗？`)) return
    try { await api(`/api/projects/${project.id}/file?path=${encodeURIComponent(file)}`, { method: 'DELETE' }); await refreshFiles(project.id); if (activePath === file) await openFile(project.id, project.mainFile) }
    catch (error) { showError(error) }
  }

  async function goHome() {
    if (!(await saveCurrent(false))) return
    setProject(null); setActivePath('')
  }

  function chooseLayout(next: Layout) {
    if (!project) return
    setLayout(next)
    localStorage.setItem(`openleaf:layout:${project.id}`, next)
  }

  function toggleFocusMode() {
    if (!focusMode) setShowSidebar(true)
    setFocusMode(value => !value)
    if (editorMode === 'visual') requestAnimationFrame(() => setVisualTarget({ offset: visualViewportOffsetRef.current, serial: ++visualTargetSerialRef.current }))
  }

  function resizeSplit(event: React.PointerEvent<HTMLDivElement>) {
    if (layout !== 'split') return
    event.currentTarget.setPointerCapture(event.pointerId)
    updateSplit(event.clientX)
  }

  function updateSplit(clientX: number): number {
    const bounds = splitRef.current?.getBoundingClientRect()
    const value = bounds ? Math.max(20, Math.min(80, Math.round((clientX - bounds.left) / bounds.width * 100))) : splitPercent
    setSplitPercent(value)
    return value
  }

  function persistSplit(value = splitPercent) {
    if (project) localStorage.setItem(`texloom:split:${project.id}`, String(value))
  }

  function updateSidebarWidth(clientX: number) {
    if (!dragStart.current) return
    const value = Math.max(230, Math.min(500, window.innerWidth - 440, dragStart.current.size + clientX - dragStart.current.x))
    setSidebarWidth(value)
    localStorage.setItem('texloom:sidebar-width', String(value))
  }

  function changeAutoCompile(value: boolean) {
    setAutoCompile(value)
    if (project) localStorage.setItem(`openleaf:auto-compile:${project.id}`, String(value))
  }

  function changeEditorPreferences(fontSize: number, wrap: 'on' | 'off') {
    if (fontSize >= 11 && fontSize <= 24) { setEditorFontSize(fontSize); localStorage.setItem('openleaf:editor-font-size', String(fontSize)) }
    setEditorWrap(wrap); localStorage.setItem('openleaf:editor-wrap', wrap)
  }

  function changeAppearance(next: Appearance) {
    setAppearance(next)
    saveAppearance(next)
  }

  function changeHighlightColor(color: string) {
    if (!highlightColors.some(option => option.latex === color)) return
    setHighlightColor(color as typeof highlightColor)
    localStorage.setItem('texloom:highlight-color', color)
  }

  function changeMode(next: 'code' | 'visual') {
    if (next === editorMode) return
    const editor = editorRef.current
    const model = editor?.getModel()
    if (next === 'visual' && editor && model) {
      const line = editor.getVisibleRanges()[0]?.startLineNumber ?? editor.getPosition()?.lineNumber ?? 1
      const offset = model.getOffsetAt({ lineNumber: line, column: 1 })
      visualViewportOffsetRef.current = offset
      setVisualTarget({ offset, serial: ++visualTargetSerialRef.current })
    }
    if (next === 'code' && editor && model) {
      const position = model.getPositionAt(Math.min(visualViewportOffsetRef.current, model.getValueLength()))
      requestAnimationFrame(() => { editor.revealPositionInCenter(position); editor.setPosition(position) })
    }
    setEditorMode(next)
  }

  function openPdfTab() {
    if (!project) return
    window.open(`/api/projects/${project.id}/pdf?mode=${pdfMode}`, '_blank', 'noopener')
  }

  const beforeEditorMount = (monaco: typeof Monaco) => {
    registerLatexLanguage(monaco)
    registerLatexCompletion(monaco, () => completionContext.current)
  }

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => commandRef.current('bold'))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => commandRef.current('italic'))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => commandRef.current('save'))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyJ, () => commandRef.current('sync:forward'))
  }

  function editVisualSpan(span: SourceSpan, expected: string, replacement: string) {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    const source = model.getValue()
    try {
      const next = replaceSourceSpan(source, span, expected, replacement)
      if (next === source) return
      editor.pushUndoStop()
      editor.executeEdits('visual', [{ range: { startLineNumber: model.getPositionAt(span.start).lineNumber, startColumn: model.getPositionAt(span.start).column, endLineNumber: model.getPositionAt(span.end).lineNumber, endColumn: model.getPositionAt(span.end).column }, text: replacement, forceMoveMarkers: true }])
      editor.pushUndoStop()
      setContent(model.getValue())
    } catch (error) { showError(error) }
  }

  function replaceInEditor(range: Monaco.IRange, text: string, selectionStart = text.length, selectionEnd = selectionStart, extra?: { offset: number; text: string }) {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) throw new Error('编辑器尚未就绪')
    const start = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn })
    const edits: Monaco.editor.IIdentifiedSingleEditOperation[] = [{ range, text, forceMoveMarkers: true }]
    if (extra) {
      const position = model.getPositionAt(extra.offset)
      edits.push({ range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column }, text: extra.text, forceMoveMarkers: true })
    }
    editor.pushUndoStop()
    editor.executeEdits('openleaf', edits)
    editor.pushUndoStop()
    const shift = extra && extra.offset <= start ? extra.text.length : 0
    const from = model.getPositionAt(start + shift + selectionStart)
    const to = model.getPositionAt(start + shift + selectionEnd)
    editor.setSelection({ startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column })
    if (editorMode !== 'visual') editor.focus()
  }

  function selectedRange(): { editor: Monaco.editor.IStandaloneCodeEditor; model: Monaco.editor.ITextModel; range: Monaco.Selection; text: string } {
    const editor = editorRef.current
    const model = editor?.getModel()
    const range = editor?.getSelection()
    if (!editor || !model || !range) throw new Error('请先打开文本文件')
    return { editor, model, range, text: model.getValueInRange(range) }
  }

  function wrapSelection(prefix: string, suffix: string, placeholder: string) {
    const { range, text } = selectedRange()
    const body = text || placeholder
    replaceInEditor(range, `${prefix}${body}${suffix}`, prefix.length, prefix.length + body.length)
  }

  async function insertHighlight() {
    if (!project) throw new Error('请先打开项目')
    const { range, text, model } = selectedRange()
    const body = text || '高亮文字'
    const multiline = /\r?\n/.test(body)
    const markup = multiline
      ? `\\noindent\\colorbox{${highlightColor}}{%\n\\parbox{\\dimexpr\\linewidth-2\\fboxsep\\relax}{%\n${body}%\n}%\n}`
      : `\\colorbox{${highlightColor}}{${body}}`
    const packagePresent = (source: string) => /\\usepackage(?:\[[^\]]*\])?\{[^}]*\bxcolor\b[^}]*\}/.test(source)
    let extra: { offset: number; text: string } | undefined
    if (activePath === project.mainFile) {
      const source = model.getValue()
      if (!packagePresent(source)) {
        const offset = source.indexOf('\\begin{document}')
        if (offset < 0) throw new Error('主文件没有 \\begin{document}')
        extra = { offset, text: '\\usepackage{xcolor}\n' }
      }
    } else {
      const url = `/api/projects/${project.id}/file?path=${encodeURIComponent(project.mainFile)}`
      const main = await api<{ content: string }>(url)
      if (!packagePresent(main.content)) {
        const offset = main.content.indexOf('\\begin{document}')
        if (offset < 0) throw new Error('主文件没有 \\begin{document}')
        await api(url, json('PUT', { content: `${main.content.slice(0, offset)}\\usepackage{xcolor}\n${main.content.slice(offset)}` }))
      }
    }
    replaceInEditor(range, markup, markup.indexOf(body), markup.indexOf(body) + body.length, extra)
  }

  function changeHeading(level: number) {
    const { model, range } = selectedRange()
    if (range.startLineNumber !== range.endLineNumber) throw new Error('标题格式一次只能应用于一行')
    const line = range.startLineNumber
    const source = model.getLineContent(line)
    const replacement = headingLine(source, level)
    replaceInEditor({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }, replacement)
  }

  function insertList(ordered: boolean) {
    const { model, range } = selectedRange()
    const lastLine = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber
    const target = { startLineNumber: range.startLineNumber, startColumn: 1, endLineNumber: lastLine, endColumn: model.getLineMaxColumn(lastLine) }
    replaceInEditor(target, listLatex(model.getValueInRange(target), ordered))
  }

  async function loadInsertIndex() {
    if (!project) return
    const serial = ++insertIndexSerial.current
    const sources = files.filter(file => file.type === 'file' && /\.(tex|bib)$/i.test(file.path)).slice(0, 100)
    const results = await Promise.allSettled(sources.map(async file => ({ file: file.path, source: file.path === activePath ? content : (await api<{ content: string }>(`/api/projects/${project.id}/file?path=${encodeURIComponent(file.path)}`)).content })))
    if (serial !== insertIndexSerial.current) return
    setInsertSources({ projectId: project.id, files: results.filter((result): result is PromiseFulfilledResult<IndexedSource> => result.status === 'fulfilled').map(result => result.value) })
  }

  function openInsertDialog(kind: InsertKind, source?: ImageSource, symbolGroup?: number, tableMode?: 'size' | 'text' | 'image') {
    const { range, text } = selectedRange()
    pendingSelection.current = { path: activePath, selection: range }
    setSelectedText(text)
    setInsertDialog({ kind, source, symbolGroup, tableMode })
    if (kind === 'reference' || kind === 'citation') void loadInsertIndex().catch(showError)
  }

  async function insertFromDialog(text: string, requiredPackage?: 'graphicx' | 'hyperref' | 'amsmath') {
    if (!project || !pendingSelection.current || pendingSelection.current.path !== activePath) throw new Error('插入位置已变化，请重新操作')
    const { model } = selectedRange()
    let extra: { offset: number; text: string } | undefined
    if (requiredPackage) {
      const hasPackage = (source: string) => [...source.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].some(match => match[1].split(',').map(name => name.trim()).includes(requiredPackage))
      if (activePath === project.mainFile) {
        const source = model.getValue()
        if (!hasPackage(source)) {
          const offset = source.indexOf('\\begin{document}')
          if (offset < 0) throw new Error('主文件没有 \\begin{document}，请先配置导言区')
          extra = { offset, text: `\\usepackage{${requiredPackage}}\n` }
        }
      } else {
        const mainUrl = `/api/projects/${project.id}/file?path=${encodeURIComponent(project.mainFile)}`
        const data = await api<{ content: string }>(mainUrl)
        if (!hasPackage(data.content)) {
          const offset = data.content.indexOf('\\begin{document}')
          if (offset < 0) throw new Error('主文件没有 \\begin{document}，请先配置导言区')
          await api(mainUrl, json('PUT', { content: `${data.content.slice(0, offset)}\\usepackage{${requiredPackage}}\n${data.content.slice(offset)}` }))
        }
      }
    }
    replaceInEditor(pendingSelection.current.selection, text, text.length, text.length, extra)
    pendingSelection.current = null
    await refreshFiles(project.id)
  }

  async function uploadInsertImage(file: File): Promise<string> {
    if (!project) throw new Error('请先打开项目')
    const path = newAssetPath(file.name)
    const form = new FormData(); form.append('file', file)
    await api(`/api/projects/${project.id}/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body: form })
    await refreshFiles(project.id)
    return path
  }

  async function copyInsertImage(sourceProjectId: string, sourcePath: string): Promise<string> {
    if (!project) throw new Error('请先打开项目')
    const result = await api<{ path: string }>(`/api/projects/${project.id}/copy-image`, json('POST', { sourceProjectId, sourcePath }))
    await refreshFiles(project.id)
    return result.path
  }

  async function importInsertImageUrl(url: string): Promise<string> {
    if (!project) throw new Error('请先打开项目')
    const result = await api<{ path: string }>(`/api/projects/${project.id}/import-image-url`, json('POST', { url }))
    await refreshFiles(project.id)
    return result.path
  }

  async function readProjectSources(): Promise<Map<string, string>> {
    if (!project) throw new Error('请先打开项目')
    const candidates = files.filter(file => file.type === 'file' && isSearchableFile(file.path) && (file.size ?? 0) <= 2 * 1024 * 1024).slice(0, 200)
    const results = await Promise.allSettled(candidates.map(async file => ({ path: file.path, content: (await api<{ content: string }>(`/api/projects/${project.id}/file?path=${encodeURIComponent(file.path)}`)).content })))
    return new Map(results.filter((result): result is PromiseFulfilledResult<{ path: string; content: string }> => result.status === 'fulfilled').map(result => [result.value.path, result.value.content]))
  }

  async function searchProject(options: SearchOptions) {
    if (!project) return
    setSearchBusy(true); setSearchError('')
    try {
      if (!(await saveCurrent(false))) throw new Error('当前文件保存失败，搜索已取消')
      setSearchHits(searchSources(await readProjectSources(), options))
    } catch (error) { setSearchError(error instanceof Error ? error.message : String(error)) }
    finally { setSearchBusy(false) }
  }

  async function replaceAllInProject(replacement: string, options: SearchOptions) {
    if (!project || !searchHits.length) return
    if (!window.confirm(`将替换项目中匹配的内容（当前显示 ${searchHits.length} 处），继续吗？`)) return
    setSearchBusy(true); setSearchError('')
    try {
      if (!(await saveCurrent(false))) throw new Error('当前文件保存失败，替换已取消')
      const sources = await readProjectSources()
      let changed = 0
      for (const [file, source] of sources) {
        const result = replaceSource(source, options, replacement)
        if (!result.count) continue
        await api(`/api/projects/${project.id}/file?path=${encodeURIComponent(file)}`, json('PUT', { content: result.content }))
        changed += result.count
        if (file === activePath) { setContent(result.content); setSavedContent(result.content) }
      }
      await refreshFiles(project.id)
      setSearchHits(searchSources(await readProjectSources(), options))
      setNotice(`已替换 ${changed} 处内容`); setTimeout(() => setNotice(''), 5500)
    } catch (error) { setSearchError(error instanceof Error ? error.message : String(error)) }
    finally { setSearchBusy(false) }
  }

  async function navigateTo(file: string, line: number, column = 1) {
    if (!project) return
    if (file !== activePath) await openFile(project.id, file)
    setTimeout(() => {
      const editor = editorRef.current
      const model = editor?.getModel()
      if (editorMode === 'visual' && file.endsWith('.tex') && model) {
        const offset = model.getOffsetAt({ lineNumber: Math.min(line, model.getLineCount()), column })
        visualSelectionRef.current = { start: offset, end: offset }
        visualViewportOffsetRef.current = offset
        setVisualTarget({ offset, serial: ++visualTargetSerialRef.current })
      } else {
        editor?.revealLineInCenter(line)
        editor?.setPosition({ lineNumber: line, column })
        editor?.focus()
      }
    }, 80)
  }

  async function currentSyncPoints(): Promise<SyncPoint[]> {
    if (!project) return []
    const result = await api<{ points: SyncPoint[] }>(`/api/projects/${project.id}/synctex?mode=${pdfMode}`)
    return result.points
  }

  async function syncSourceToPdf() {
    const model = editorRef.current?.getModel()
    const visualOffset = visualSelectionRef.current?.start ?? visualViewportOffsetRef.current
    const line = editorMode === 'visual' && model ? model.getPositionAt(Math.min(visualOffset, model.getValueLength())).lineNumber : editorRef.current?.getPosition()?.lineNumber
    if (!line || !activePath.endsWith('.tex')) { showError('请先在 LaTeX 源码中放置光标'); return }
    try {
      const matches = (await currentSyncPoints()).filter(point => point.file === activePath)
      if (!matches.length) throw new Error('当前 PDF 没有该文件的定位数据，请重新编译')
      const point = matches.reduce((best, item) => Math.abs(item.line - line) < Math.abs(best.line - line) ? item : best)
      if (layout === 'editor') chooseLayout('split')
      setPdfTarget({ page: point.page, x: point.x, y: point.y, serial: Date.now() })
    } catch (error) { showError(error) }
  }

  async function syncPdfToSource(page: number, x: number, y: number) {
    try {
      const matches = (await currentSyncPoints()).filter(point => point.page === page)
      if (!matches.length) throw new Error('当前 PDF 没有定位数据，请重新编译')
      const point = matches.reduce((best, item) => {
        const score = (value: SyncPoint) => Math.abs(value.y - y) * 4 + Math.abs(value.x - x) * .15 + (value.kind === 'box' ? 2 : 0)
        return score(item) < score(best) ? item : best
      })
      if (layout === 'pdf') chooseLayout('split')
      await navigateTo(point.file, point.line)
    } catch (error) { showError(error) }
  }

  function openReview(type: 'comment' | 'suggestion') {
    try {
      if (editorMode === 'visual' && !restoreVisualSelection(true)) return
      const { model, range, text } = selectedRange()
      if (type === 'suggestion' && !text) throw new Error('请先选中需要修改的源码')
      setReviewDraft({ type, file: activePath, line: range.startLineNumber, column: range.startColumn, offset: model.getOffsetAt(range.getStartPosition()), original: text })
    } catch (error) { showError(error) }
  }

  function reviewVisualCard(block: VisualBlock) {
    const model = editorRef.current?.getModel()
    if (!model) return
    const start = block.caption?.start ?? block.start
    const position = model.getPositionAt(start)
    setReviewDraft({ type: 'comment', file: activePath, line: position.lineNumber, column: position.column, offset: start, original: model.getValue().slice(start, Math.min(block.caption?.end ?? start + 200, start + 20_000)) })
  }

  async function compileVisualCard(block: VisualBlock): Promise<string> {
    if (!project) throw new Error('请先打开项目')
    if (!(await saveCurrent(false))) throw new Error('保存失败，无法编译卡片')
    const result = await api<{ url: string }>(`/api/projects/${project.id}/card-preview`, json('POST', { file: activePath, start: block.start, end: block.end, expected: block.raw }))
    return result.url
  }

  function resolveVisualAsset(name: string): string {
    const normalized = name.replace(/\\/g, '/')
    const folder = activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/') + 1) : ''
    const candidates = [normalized, `${folder}${normalized}`]
    for (const candidate of candidates) for (const suffix of ['', '.png', '.jpg', '.jpeg', '.pdf']) {
      const found = `${candidate}${suffix}`
      if (files.some(file => file.type === 'file' && file.path === found)) return found
    }
    return normalized
  }

  function toggleDraftCard(block: VisualBlock) {
    if (!project) return
    const key = draftCardKey(activePath, block, content)
    setDraftCards(previous => {
      const next = previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]
      localStorage.setItem(`texloom:draft-cards:${project.id}`, JSON.stringify(next))
      return next
    })
  }

  async function submitReview(body: string, proposed: string) {
    if (!project || !reviewDraft) throw new Error('没有待保存的审阅内容')
    if (!(await saveCurrent(false))) throw new Error('当前文件保存失败，审阅内容未提交')
    await api(`/api/projects/${project.id}/review`, json('POST', { ...reviewDraft, body, proposed: reviewDraft.type === 'suggestion' ? proposed : undefined }))
    setReviewThreads(await api<ReviewThread[]>(`/api/projects/${project.id}/review`))
    setActivePanel('review'); setShowSidebar(true)
  }

  async function reviewAction(id: string, action: 'reply' | 'resolve' | 'reopen' | 'accept' | 'reject', body?: string) {
    if (!project) return
    try {
      if (action === 'accept' && !(await saveCurrent(false))) return
      const result = await api<ReviewThread>(`/api/projects/${project.id}/review/${id}`, json('PATCH', { action, body }))
      setReviewThreads(await api<ReviewThread[]>(`/api/projects/${project.id}/review`))
      if (action === 'accept') {
        await refreshFiles(project.id)
        if (result.file === activePath) {
          const data = await api<{ content: string }>(`/api/projects/${project.id}/file?path=${encodeURIComponent(activePath)}`)
          setContent(data.content); setSavedContent(data.content)
        }
      }
    } catch (error) { showError(error) }
  }

  async function createProjectSnapshot(note: string) {
    if (!project) return
    try {
      if (!(await saveCurrent(false))) return
      await api(`/api/projects/${project.id}/history`, json('POST', { note }))
      setSnapshots(await api<Snapshot[]>(`/api/projects/${project.id}/history`))
    } catch (error) { showError(error) }
  }

  async function restoreProjectSnapshot(id: string) {
    if (!project || !window.confirm('恢复快照会替换当前项目文件，并自动创建恢复前备份。确定继续吗？')) return
    try {
      if (!(await saveCurrent(false))) return
      await api(`/api/projects/${project.id}/history/${id}/restore`, { method: 'POST' })
      const nextFiles = await refreshFiles(project.id)
      setSnapshots(await api<Snapshot[]>(`/api/projects/${project.id}/history`))
      const target = nextFiles.some(file => file.path === activePath) ? activePath : project.mainFile
      const data = await api<{ content: string }>(`/api/projects/${project.id}/file?path=${encodeURIComponent(target)}`)
      setActivePath(target); setContent(data.content); setSavedContent(data.content)
      setNotice('快照已恢复，请重新编译 PDF'); setTimeout(() => setNotice(''), 5500)
    } catch (error) { showError(error) }
  }

  async function gitAction(action: 'init' | 'commit' | 'remote' | 'push' | 'pull', payload?: { message?: string; name?: string; email?: string; url?: string }): Promise<boolean> {
    if (!project) return false
    const sync = action === 'push' || action === 'pull'
    if (sync) setGitFeedback({ action, status: 'running', message: action === 'push' ? '正在推送已提交的内容…' : '正在拉取远程内容…' })
    else if (action === 'remote') setGitFeedback(null)
    try {
      if ((action === 'commit' || action === 'pull') && !(await saveCurrent(false))) throw new Error('当前文件保存失败，Git 操作已取消')
      const body = action === 'init' ? undefined : action === 'remote' ? { url: payload?.url } : action === 'commit' ? payload : { action }
      const result = await api<{ reviewError?: string; project?: Project }>(`/api/projects/${project.id}/git/${action === 'push' || action === 'pull' ? 'sync' : action}`, body ? json('POST', body) : { method: 'POST' })
      if (sync) setGitFeedback({ action, status: result.reviewError ? 'error' : 'success', message: result.reviewError ? `源码${action === 'push' ? '推送' : '拉取'}成功；审阅同步失败：${result.reviewError}` : action === 'push' ? '推送成功：源码与审阅记录已同步' : '拉取成功：源码与审阅记录已同步' })
      try { setGitState(await api<GitState>(`/api/projects/${project.id}/git`)) }
      catch (error) { showError(error); if (!sync) return false }
      if (sync) setReviewThreads(await api<ReviewThread[]>(`/api/projects/${project.id}/review`))
      if (action === 'pull') {
        const nextProject = result.project ?? project
        setProject(nextProject)
        const nextFiles = await refreshFiles(project.id)
        const nextPath = nextFiles.some(file => file.type === 'file' && file.path === activePath) ? activePath : nextProject.mainFile
        const data = await api<{ content: string }>(`/api/projects/${project.id}/file?path=${encodeURIComponent(nextPath)}`)
        setActivePath(nextPath); setContent(data.content); setSavedContent(data.content)
        setPdfTarget(null); setPdfVersion(Date.now()); setJob(null)
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (sync) setGitFeedback({ action, status: 'error', message: `${action === 'push' ? '推送失败' : '拉取失败'}：${message}` })
      showError(error)
      return false
    }
  }

  async function reloadReview(): Promise<void> {
    if (!project) return
    setReviewThreads(await api<ReviewThread[]>(`/api/projects/${project.id}/review`))
    setGitState(await api<GitState>(`/api/projects/${project.id}/git`))
  }

  async function changeGitBranch(name: string, create: boolean, from?: string): Promise<boolean> {
    if (!project) return false
    try {
      if (!(await saveCurrent(false))) return false
      const result = await api<{ project?: Project }>(`/api/projects/${project.id}/git/${create ? 'branch' : 'switch'}`, json('POST', create ? { name, from } : { name }))
      const next = result.project ?? project
      setProject(next)
      const nextFiles = await refreshFiles(project.id)
      const file = nextFiles.some(item => item.type === 'file' && item.path === activePath) ? activePath : next.mainFile
      const data = await api<{ content: string }>(`/api/projects/${project.id}/file?path=${encodeURIComponent(file)}`)
      setActivePath(file); setContent(data.content); setSavedContent(data.content)
      setPdfVersion(Date.now()); setPdfTarget(null); setJob(null)
      setGitState(await api<GitState>(`/api/projects/${project.id}/git`))
      setReviewThreads(await api<ReviewThread[]>(`/api/projects/${project.id}/review`))
      return true
    } catch (error) { showError(error); return false }
  }

  async function saveAiSettings(settings: AiSettingsInput) {
    try {
      setAiSettings(await api<AiSettingsView>('/api/ai/settings', json('PUT', settings)))
      setNotice('AI 设置已保存'); setTimeout(() => setNotice(''), 5500)
    } catch (error) { showError(error) }
  }

  async function requestAi(mode: string, prompt: string, imageDataUrl?: string, selectionOverride?: Monaco.Selection) {
    if (!project) return
    if (!aiSettings.configured) { setActivePanel('settings'); setAiError('请先配置 AI API Key'); return }
    if (!selectionOverride && editorMode === 'visual') restoreVisualSelection(false)
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = selectionOverride ?? editor?.getSelection()
    const selected = model && selection ? model.getValueInRange(selection) : ''
    if (['translate', 'polish', 'rewrite'].includes(mode) && !selected.trim()) { setAiError('请先在编辑器中选中需要处理的源码'); setActivePanel('ai'); return }
    if (['rewrite', 'formula', 'table', 'custom'].includes(mode) && !prompt.trim()) { setAiError('请先填写具体要求'); setActivePanel('ai'); return }
    if (mode === 'chat' && !prompt.trim()) return
    const context = mode === 'explain' ? (job?.log ?? '').slice(-12000) : ''
    if (mode === 'explain' && !context && !selected && !prompt.trim()) { setAiError('请先编译或选中需要解释的内容'); setActivePanel('ai'); return }
    setActivePanel('ai'); setShowSidebar(true); setAiError(''); setAiBusy(true)
    aiTarget.current = selection ? { path: activePath, selection, original: selected } : null
    setAiOutput({ mode, text: '', selectedText: selected, path: activePath })
    const controller = new AbortController()
    aiController.current = controller
    try {
      const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, prompt, selectedText: selected, context, imageDataUrl }), signal: controller.signal })
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error || `AI 请求失败（${response.status}）`) }
      if (!response.body) throw new Error('AI 响应为空')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''
        for (const event of events) for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; error?: string }
          if (chunk.error) throw new Error(chunk.error)
          const text = chunk.choices?.[0]?.delta?.content
          if (text) setAiOutput(previous => previous ? { ...previous, text: previous.text + text } : null)
        }
      }
    } catch (error) { if (!controller.signal.aborted) setAiError(error instanceof Error ? error.message : String(error)) }
    finally { setAiBusy(false); aiController.current = null }
  }

  async function recognizeTableImage(file: File) {
    try {
      const selection = pendingSelection.current?.selection
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MB 以内的 PNG 或 JPEG 图片')
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('无法读取图片'))
        reader.readAsDataURL(file)
      })
      await requestAi('table', '将图片中的表格转换为 LaTeX 表格', dataUrl, selection)
    } catch (error) { showError(error) }
  }

  function applyAiResult() {
    if (!aiOutput?.text || !aiTarget.current || aiTarget.current.path !== activePath) { showError('编辑位置已变化，请重新发起 AI 请求'); return }
    try {
      const { model } = selectedRange()
      if (model.getValueInRange(aiTarget.current.selection) !== aiTarget.current.original) throw new Error('选中内容已改变，请重新发起 AI 请求')
      let text = aiOutput.text.trim().replace(/^```(?:latex|tex)?\s*\n?/, '').replace(/\n?```$/, '')
      if (aiOutput.mode === 'formula' && !/^\\\(|^\\\[|^\$/.test(text)) text = `\\(${text}\\)`
      replaceInEditor(aiTarget.current.selection, text)
      setAiDiffOpen(false)
    } catch (error) { showError(error) }
  }

  function runEditorCommand(command: string): boolean {
    const editor = editorRef.current
    if (!editor) return false
    if (command === 'undo' || command === 'redo') { editor.trigger('openleaf', command, null); visualSelectionRef.current = null; if (editorMode !== 'visual') editor.focus(); return true }
    if (command === 'find') { void editor.getAction('actions.find')?.run(); return true }
    if (!activePath.endsWith('.tex')) throw new Error('该操作仅适用于 .tex 文件')
    if (command === 'bold') { wrapSelection('\\textbf{', '}', '文本'); return true }
    if (command === 'highlight') { void insertHighlight().catch(showError); return true }
    if (command === 'italic') { wrapSelection('\\textit{', '}', '文本'); return true }
    if (command === 'insert:math') { wrapSelection('\\(', '\\)', 'x'); return true }
    if (command === 'insert:heading') { changeHeading(1); return true }
    if (command === 'insert:list' || command === 'list:0') { insertList(false); return true }
    if (command === 'list:1') { insertList(true); return true }
    if (command.startsWith('style:')) { changeHeading(Number(command.slice(6))); return true }
    if (command === 'insert:symbol' || command.startsWith('symbol:')) { openInsertDialog('symbol', undefined, command.startsWith('symbol:') ? Number(command.slice(7)) : 0); return true }
    if (command === 'insert:link') { openInsertDialog('link'); return true }
    if (command === 'insert:reference') { openInsertDialog('reference'); return true }
    if (command === 'insert:citation') { openInsertDialog('citation'); return true }
    if (command === 'insert:image' || command.startsWith('image:')) { openInsertDialog('image', (['local', 'project', 'other', 'url'] as const)[Number(command.slice(6))] ?? 'local'); return true }
    if (command === 'insert:table' || command === 'table:0' || command === 'table:1') { openInsertDialog('table', undefined, undefined, command === 'table:1' ? 'text' : 'size'); return true }
    if (command === 'table:2') { openInsertDialog('table', undefined, undefined, 'image'); return true }
    return false
  }

  function handleCommand(command: string) {
    if (command === 'sync:forward') { void syncSourceToPdf(); return }
    if (command.startsWith('panel:')) { setShowSidebar(true); setActivePanel(command.slice(6) as PanelId); return }
    if (command.startsWith('layout:')) { chooseLayout(command.slice(7) as Layout); return }
    if (command === 'comment' || command === 'suggestion') { openReview(command); return }
    if (command === 'more:0') { setActivePanel('ai'); setShowSidebar(true); return }
    if (command === 'more:1') { void requestAi('translate', '翻译选中的内容'); return }
    if (command === 'more:2') { void requestAi('explain', '解释选中的内容或编译错误'); return }
    if (/^(undo|redo|find|bold|highlight|italic|insert:|style:|symbol:|image:|table:|list:)/.test(command)) {
      try { if (runEditorCommand(command)) return } catch (error) { showError(error); return }
    }
    switch (command) {
      case 'home': void goHome(); return
      case 'newProject': void beginNewProject(); return
      case 'cloneProject': setModal('clone'); setModalValue(''); return
      case 'importZip': importRef.current?.click(); return
      case 'newFile': setModal('file'); setModalValue(''); return
      case 'upload': uploadRef.current?.click(); return
      case 'save': void saveCurrent(); return
      case 'compile': void compile(); return
      case 'toggleAutoCompile': changeAutoCompile(!autoCompile); return
      case 'toggleSidebar': setShowSidebar(value => !value); return
      case 'toggleLogs': setShowLogs(value => !value); return
      case 'pdfTab': openPdfTab(); return
      case 'downloadPdf': if (project) window.open(`/api/projects/${project.id}/pdf?mode=${pdfMode}&v=${pdfVersion}`, '_blank', 'noopener'); return
      case 'exportZip': if (project) window.location.href = `/api/projects/${project.id}/export`; return
      case 'rename': {
        if (!project) return
        const name = window.prompt('项目新名称', project.name)
        if (!name) return
        void api<Project>(`/api/projects/${project.id}`, json('PATCH', { name })).then(next => { setProject(next); void refreshProjects() }).catch(showError)
        return
      }
      case 'setMain': {
        if (!project) return
        const file = window.prompt('主 .tex 文件路径', project.mainFile)
        if (!file) return
        void api<Project>(`/api/projects/${project.id}`, json('PATCH', { mainFile: file })).then(setProject).catch(showError)
        return
      }
      case 'deleteProject': void deleteProject(); return
      case 'help': window.open('https://tectonic-typesetting.github.io/book/latest/', '_blank', 'noopener'); return
      case 'shortcuts': setShowShortcuts(true); return
      case 'about': setNotice('TeXloom 0.1 · 本地 LaTeX 工作台'); setTimeout(() => setNotice(''), 5500); return
      default: setNotice('无法识别此操作'); setTimeout(() => setNotice(''), 5500)
    }
  }

  function handleVisualToolbarCommand(command: string) {
    if (editorMode === 'visual' && activePath.endsWith('.tex') && /^(bold|highlight|italic|insert:|style:|symbol:|image:|table:|list:|comment$)/.test(command)) {
      if (!restoreVisualSelection(true)) return
      if (command !== 'comment') visualSelectionRef.current = null
    }
    handleCommand(command)
  }

  function agentSourceSelection(): { path: string; start: number; end: number } | null {
    const model = editorRef.current?.getModel()
    if (!model || !activePath) return null
    if (editorMode === 'visual') {
      const span = visualSelectionRef.current
      return span && span.end > span.start && span.end <= model.getValueLength() ? { path: activePath, ...span } : null
    }
    const selection = editorRef.current?.getSelection()
    if (!selection || selection.isEmpty()) return null
    const start = model.getOffsetAt(selection.getStartPosition())
    const end = model.getOffsetAt(selection.getEndPosition())
    return end > start ? { path: activePath, start, end } : null
  }

  function restoreVisualSelection(required: boolean): boolean {
    const span = visualSelectionRef.current
    const model = editorRef.current?.getModel()
    if (!span || !model || span.end > model.getValueLength()) {
      if (required) showError('请先在可视化正文中放置光标或选择文字')
      return false
    }
    const from = model.getPositionAt(span.start)
    const to = model.getPositionAt(span.end)
    editorRef.current?.setSelection({ startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column })
    return true
  }

  commandRef.current = handleCommand

  return <div className={`app-shell ${focusMode ? 'focus-mode' : ''} ${editorMode === 'visual' ? 'visual-workspace' : ''}`}>
    <header className="topbar"><button className="brand" onClick={() => { if (project) void goHome(); else onExit() }}><span className="brand-mark"><img src="/icon.png" alt="" /></span><span className="brand-name">TeXloom</span></button>{project && <WorkspaceMenuBar onCommand={handleCommand} />}<div className="topbar-right"><div className="workspace-location" ref={workspaceBadgeRef}><button className="local-badge" type="button" aria-expanded={workspaceOpen} onClick={() => { setWorkspaceOpen(value => !value); void refreshWorkspace(project?.id).catch(showError) }}><span className="local-dot" />本地工作空间<ChevronDown size={14} /></button>{workspaceOpen && <div className="workspace-location-menu"><h3>项目存储位置</h3>{project && <><label>当前项目文件夹</label><code>{workspaceInfo?.projectPath || '读取中…'}</code></>}<label>{project ? '当前项目所在根目录' : '当前项目根目录'}</label><code>{project ? workspaceInfo?.projectRoot || '读取中…' : workspaceInfo?.root || '读取中…'}</code>{project && workspaceInfo?.projectRoot !== workspaceInfo?.root && <><label>新项目根目录</label><code>{workspaceInfo?.root}</code></>}<p>更换根目录后，新项目保存在新位置；已有项目仍在原位置。</p><button type="button" onClick={() => { setWorkspaceOpen(false); setRootDialog('change') }}><FolderOpen size={15} />修改根目录</button></div>}</div><a className="top-help" href="https://tectonic-typesetting.github.io/book/latest/" target="_blank" rel="noreferrer"><CircleHelp size={17} />帮助文档</a></div></header>
    {project ? <div className="workspace">
      {showSidebar && <><div className="sidebar-shell" style={{ width: activePanel ? sidebarWidth : 48 }}><WorkspaceSidebar project={project} files={files} activePath={activePath} activePanel={activePanel} outline={outline} activeOutlineLine={visualLine} searchHits={searchHits} searchBusy={searchBusy} searchError={searchError} reviewThreads={reviewThreads} snapshots={snapshots} gitState={gitState} gitFeedback={gitFeedback} aiSettings={aiSettings} aiOutput={aiOutput} aiBusy={aiBusy} aiError={aiError} editorFontSize={editorFontSize} editorWrap={editorWrap} autoCompile={autoCompile} appearance={appearance} highlightColor={highlightColor} onHighlightColor={changeHighlightColor} onPanelChange={setActivePanel} onCommand={handleCommand} onOpenFile={file => void openFile(project.id, file)} onDeleteFile={file => void deleteFile(file)} onNavigate={(file, line, column) => void navigateTo(file, line, column)} onSearch={options => void searchProject(options)} onReplaceAll={(replacement, options) => void replaceAllInProject(replacement, options)} onAddReview={openReview} onReviewAction={(id, action, body) => void reviewAction(id, action, body)} onCreateSnapshot={note => void createProjectSnapshot(note)} onRestoreSnapshot={id => void restoreProjectSnapshot(id)} onGitAction={gitAction} onGitBranchChange={changeGitBranch} onReviewReload={reloadReview} onAiRequest={(mode, prompt) => void requestAi(mode, prompt)} onAiApply={() => setAiDiffOpen(true)} onAiCancel={() => aiController.current?.abort()} onSaveAiSettings={settings => void saveAiSettings(settings)} onEditorPreferences={changeEditorPreferences} onAutoCompile={changeAutoCompile} onAppearanceChange={changeAppearance} onPackageEnsureSaved={() => saveCurrent(false)} onPackageSelectedText={() => { const editor = editorRef.current; const selection = editor?.getSelection(); return editor && selection ? editor.getModel()?.getValueInRange(selection) ?? '' : '' }} onPackageApplied={(file, source) => { if (file === activePath) { setContent(source); setSavedContent(source) } void refreshProjects() }} onAgentGetSelection={agentSourceSelection} onAgentBeforeRun={() => saveCurrent(false)} onAgentApplied={paths => { if (paths.includes(activePath)) void openFile(project.id, activePath); void refreshProjects() }} /></div>{activePanel && <div className="sidebar-width-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" tabIndex={0} onPointerDown={event => { dragStart.current = { x: event.clientX, y: event.clientY, size: sidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSidebarWidth(event.clientX) }} onPointerUp={event => { dragStart.current = null; event.currentTarget.releasePointerCapture(event.pointerId) }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const value = Math.max(230, Math.min(500, sidebarWidth + (event.key === 'ArrowLeft' ? -12 : 12))); setSidebarWidth(value); localStorage.setItem('texloom:sidebar-width', String(value)) } }} />}</>}
      <main className="work-main"><div className="workspace-toolbar"><div className="crumbs">{!showSidebar && <button className="icon-button" onClick={() => setShowSidebar(true)} title="展开侧边栏"><PanelLeftOpen size={18} /></button>}<span>{project.name}</span><ChevronRight size={15} /><strong>{activePath || project.mainFile}</strong></div><div className="workspace-actions"><LayoutPicker layout={layout} onChoose={chooseLayout} onOpenTab={openPdfTab} /><span className="save-state">{saving ? <><LoaderCircle size={14} className="spin" />保存中</> : dirty ? <><span className="unsaved-dot" />未保存</> : <><Save size={14} />已保存</>}</span><button className="soft-button" onClick={() => void saveCurrent()}><Save size={15} />保存</button><button className={`auto-button ${autoCompile ? 'on' : ''}`} onClick={() => changeAutoCompile(!autoCompile)} title={`自动编译：${autoCompile ? '开启' : '关闭'}`} aria-label={`自动编译：${autoCompile ? '开启' : '关闭'}`}><RefreshCw size={16} /></button><button className="soft-button" onClick={() => void compileDraft()} disabled={busy || !tectonicReady} title="未勾选的图表在草稿 PDF 中显示占位框">草稿编译</button><button className="primary-button" onClick={() => void compile()} disabled={busy || !tectonicReady}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} fill="currentColor" />}{busy ? '编译中' : '编译 PDF'}</button></div></div><div ref={splitRef} className={`editor-preview layout-${layout}`} style={{ '--editor-percent': `${splitPercent}%` } as React.CSSProperties}><section className="editor-pane"><div className="pane-title"><div className="pane-title-label"><Code2 size={17} /><strong>源文件</strong><span className="pane-subtitle">{activePath}</span></div><div className="editor-mode-switch" role="tablist" aria-label="编辑模式"><button type="button" role="tab" aria-selected={editorMode === 'code'} className={editorMode === 'code' ? 'active' : ''} onClick={() => changeMode('code')}>Code</button><button type="button" role="tab" aria-selected={editorMode === 'visual'} className={editorMode === 'visual' ? 'active' : ''} disabled={!activePath.endsWith('.tex')} onClick={() => changeMode('visual')}>Visual</button></div><button type="button" className={`focus-toggle ${focusMode ? 'active' : ''}`} aria-label={focusMode ? '退出专注模式' : '开启专注模式'} title={focusMode ? '退出专注模式（Esc）' : '开启专注模式'} onClick={toggleFocusMode}>{focusMode ? <><Minimize2 size={14} />退出专注 <kbd>Esc</kbd></> : <><Maximize2 size={14} />专注</>}</button></div><EditorToolbar onCommand={handleVisualToolbarCommand} /><div className="editor-wrap" style={{ display: editorMode === 'visual' && activePath.endsWith('.tex') ? 'none' : undefined }}><Editor path={activePath} language={activePath.endsWith('.tex') ? latexLanguageId : 'plaintext'} value={content} onChange={value => setContent(value ?? '')} beforeMount={beforeEditorMount} onMount={onEditorMount} theme={latexThemeName(appearance.theme)} options={{ fontSize: Math.round(editorFontSize * appearance.size / 14), lineHeight: Math.round(24 * appearance.size / 14), minimap: { enabled: false }, wordWrap: editorWrap, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 18 }, fontFamily: fontFamilies[appearance.font], renderLineHighlight: 'line', lineNumbersMinChars: 3 }} /></div>{editorMode === 'visual' && activePath.endsWith('.tex') && <VisualEditor source={content} projectId={project.id} file={activePath} draftCards={draftCards} onToggleDraft={toggleDraftCard} assetPath={resolveVisualAsset} onCompileCard={compileVisualCard} onReviewCard={reviewVisualCard} onEdit={editVisualSpan} onUndo={() => editorRef.current?.trigger('visual', 'undo', null)} onRedo={() => editorRef.current?.trigger('visual', 'redo', null)} onFocus={() => editorRef.current?.pushUndoStop()} onBlur={() => editorRef.current?.pushUndoStop()} onSelection={span => { visualSelectionRef.current = span }} onViewport={offset => { visualViewportOffsetRef.current = offset; const line = editorRef.current?.getModel()?.getPositionAt(offset).lineNumber; if (line) setVisualLine(line) }} target={visualTarget} />}</section><div className="pane-resizer" role="separator" aria-label="调整编辑器与 PDF 宽度" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={splitPercent} tabIndex={layout === 'split' ? 0 : -1} onPointerDown={resizeSplit} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSplit(event.clientX) }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { persistSplit(updateSplit(event.clientX)); event.currentTarget.releasePointerCapture(event.pointerId) } }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const value = Math.max(20, Math.min(80, splitPercent + (event.key === 'ArrowLeft' ? -2 : 2))); setSplitPercent(value); persistSplit(value) } }} onDoubleClick={() => { setSplitPercent(50); persistSplit(50) }} /><PdfPreview projectId={project.id} version={pdfVersion} mode={pdfMode} target={pdfTarget} onReverse={syncPdfToSource} /></div><div className={`log-panel ${showLogs ? 'open' : ''}`}><button className="log-heading" onClick={() => setShowLogs(!showLogs)}><div><span className={`compile-indicator ${job?.status || ''}`} />编译日志{job && <span className="log-status">{job.status === 'running' ? '正在编译' : job.status === 'success' ? '编译成功' : '编译失败'}</span>}</div><ChevronDown size={16} className={showLogs ? 'flip' : ''} /></button>{showLogs && <pre>{job?.log || (busy ? '正在启动 Tectonic…' : '暂无编译记录')}</pre>}</div></main>
    </div> : <Dashboard projects={projects} onOpen={item => void openProject(item)} onRefresh={refreshProjects} onCreate={() => void beginNewProject()} onImportZip={() => importRef.current?.click()} onClone={() => { setModal('clone'); setModalValue('') }} />}

    <input ref={uploadRef} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /><input ref={importRef} type="file" accept=".zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importZip(file); event.target.value = '' }} />
    {rootDialog && workspaceInfo && <WorkspaceRootDialog info={workspaceInfo} firstProject={rootDialog === 'create'} onClose={() => setRootDialog(null)} onConfigured={() => { const action = rootDialog; setRootDialog(null); void refreshWorkspace(project?.id).catch(showError); void refreshProjects().catch(showError); if (action === 'create') { setModal('project'); setModalValue('') } }} />}
    {notice && <div role="alert" className="notice"><CircleHelp size={17} />{notice}<button onClick={() => setNotice('')}><X size={16} /></button></div>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null) }}><form className="modal" onSubmit={event => { event.preventDefault(); void submitModal() }}><div className="modal-icon">{modal === 'project' ? <BookOpen size={23} /> : modal === 'clone' ? <GitBranch size={23} /> : <FilePlus2 size={23} />}</div><h2>{modal === 'project' ? '新建 LaTeX 项目' : modal === 'clone' ? '导入 GitHub 私有仓库' : '新建文件'}</h2><p>{modal === 'project' ? '创建一个新的本地工作空间，开始编写文档。' : modal === 'clone' ? '输入仓库地址。首次连接会打开系统 GitHub 登录，完成后自动导入。' : '输入文件路径，例如 chapter/intro.tex。'}</p><label>{modal === 'project' ? '项目名称' : modal === 'clone' ? 'GitHub 仓库地址' : '文件路径'}<input autoFocus value={modalValue} onChange={event => setModalValue(event.target.value)} placeholder={modal === 'project' ? '例如：研究论文' : modal === 'clone' ? 'https://github.com/owner/private-repo' : '例如：chapter/intro.tex'} /></label><div className="modal-actions"><button type="button" className="outline-button" onClick={() => setModal(null)}>取消</button><button type="submit" className="primary-button" disabled={!modalValue.trim() || modalBusy}>{modalBusy ? '连接中…' : modal === 'clone' ? '连接并导入' : '创建'}</button></div></form></div>}
    {insertDialog && project && <InsertDialog kind={insertDialog.kind} initialSource={insertDialog.source} initialSymbolGroup={insertDialog.symbolGroup} initialTableMode={insertDialog.tableMode} selectedText={selectedText} references={references} citations={citations} imageFiles={files.filter(file => file.type === 'file' && /\.(png|jpe?g|pdf)$/i.test(file.path)).map(file => file.path)} projects={projects} currentProjectId={project.id} onClose={() => { setInsertDialog(null); pendingSelection.current = null }} onInsert={insertFromDialog} onUploadImage={uploadInsertImage} onCopyImage={copyInsertImage} onImportImageUrl={importInsertImageUrl} onListProjectFiles={async id => (await api<FileEntry[]>(`/api/projects/${id}/files`)).filter(file => file.type === 'file' && /\.(png|jpe?g|pdf)$/i.test(file.path)).map(file => file.path)} onImageTableAi={file => void recognizeTableImage(file)} onRefreshReferences={loadInsertIndex} />}
    {reviewDraft && <ReviewDialog draft={reviewDraft} onClose={() => setReviewDraft(null)} onSubmit={submitReview} />}
    {aiDiffOpen && aiOutput && <AiDiffDialog original={aiOutput.selectedText} proposed={aiOutput.text} onClose={() => setAiDiffOpen(false)} onApply={applyAiResult} />}
    {showShortcuts && <div className="shortcuts-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowShortcuts(false) }}><div className="shortcuts-dialog" role="dialog" aria-modal="true" aria-label="快捷键"><h2>快捷键</h2><dl><div><dt>保存文件</dt><dd>Ctrl+S</dd></div><div><dt>撤销</dt><dd>Ctrl+Z</dd></div><div><dt>重做</dt><dd>Ctrl+Y</dd></div><div><dt>加粗</dt><dd>Ctrl+B</dd></div><div><dt>斜体</dt><dd>Ctrl+I</dd></div><div><dt>当前文件查找</dt><dd>Ctrl+F</dd></div><div><dt>源码定位 PDF</dt><dd>Ctrl+Alt+J</dd></div><div><dt>PDF 定位源码</dt><dd>双击 PDF 页面</dd></div></dl><button onClick={() => setShowShortcuts(false)}>关闭</button></div></div>}
  </div>
}

function StandalonePdf({ projectId }: { projectId: string }) {
  const [name, setName] = useState('PDF 预览')
  const [version] = useState(Date.now)
  useEffect(() => {
    void api<Project>(`/api/projects/${projectId}`).then(project => {
      setName(project.name)
      document.title = `${project.name} · PDF 预览 · TeXloom`
    }).catch(() => setName('项目不可用'))
  }, [projectId])
  return <div className="standalone-pdf">
    <header className="standalone-header"><span className="standalone-brand"><img src="/icon.png" alt="" />TeXloom</span><span className="standalone-project">{name}</span></header>
    <PdfPreview projectId={projectId} version={version} />
  </div>
}

const params = new URLSearchParams(window.location.search)
const pdfProject = params.get('view') === 'pdf' ? params.get('project') : null

function ProductRouter() {
  const [page, setPage] = useState<'landing' | 'workspace'>(() => new URLSearchParams(window.location.search).get('view') === 'workspace' ? 'workspace' : 'landing')
  useEffect(() => {
    const update = () => setPage(new URLSearchParams(window.location.search).get('view') === 'workspace' ? 'workspace' : 'landing')
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  useEffect(() => { document.title = page === 'landing' ? 'TeXloom · 让研究成为主角' : 'TeXloom · 本地 LaTeX 工作台' }, [page])
  function navigate(next: 'landing' | 'workspace') {
    window.history.pushState({}, '', next === 'landing' ? '/' : '/?view=workspace')
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  return page === 'landing' ? <Landing onEnter={() => navigate('workspace')} /> : <App onExit={() => navigate('landing')} />
}

createRoot(document.getElementById('root')!).render(pdfProject ? <StandalonePdf projectId={pdfProject} /> : <ProductRouter />)
