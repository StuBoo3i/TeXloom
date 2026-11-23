import { getLanguage, t } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { BookOpen, Bold, Bot, Braces, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Columns2, Download, File, FileClock, FilePlus2, FileText, Folder, GitBranch, Heading, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, LocateFixed, MessageSquare, MoreHorizontal, Omega, Paperclip, Plus, Redo2, Search, Settings2, Sigma, Sparkles, Table2, Tag, TerminalSquare, Undo2, Upload, X } from 'lucide-react'
import './workspace-ui.css'
import './workspace-features.css'
import './review-panel.css'
import './ai-panel.css'
import './settings-controls.css'
import type { OutlineEntry, SearchHit, SearchOptions } from './project-analysis'
import { AppearanceSettings } from './appearance-settings'
import { GitRemotePanel } from './git-remote-panel'
import { GitCollaborationPanel } from './git-collaboration-panel'
import { PackageAdvicePanel } from './package-advice-panel'
import { AiServiceSettings, type AiSettingsInput, type AiSettingsView } from './ai-service-settings'
import { AgentConsole, type AgentSourceSelection } from './agent-console'
import { AgentProfileSettings } from './agent-profile-settings'
import { mikuSidebarArtwork, type Appearance } from './appearance'
import { highlightColors } from './highlight'
import { automaticSnapshotLimit, type Snapshot } from '../../shared/snapshots'

export type PanelId = 'files' | 'search' | 'review' | 'history' | 'integrations' | 'ai' | 'agent' | 'settings'
export type WorkspaceFile = { path: string; type: 'file' | 'directory'; size?: number }
export type WorkspaceProject = { id: string; name: string; mainFile: string }
export type ReviewThread = { id: string; file: string; line: number; column: number; original: string; body: string; author?: string; proposed?: string; type: 'comment' | 'suggestion'; status: 'open' | 'resolved' | 'accepted' | 'rejected'; createdAt: string; replies: { id: string; body: string; author?: string; createdAt: string }[]; target?: { branch: string; commit: string; blob: string }; locationStale?: boolean }
export type GitState = { initialized: boolean; branch: string; remote: string; status: string; commits: { id: string; shortId: string; date: string; message: string }[]; authorName?: string; authorEmail?: string }
export type GitFeedback = { action: 'push' | 'pull'; status: 'running' | 'success' | 'error'; message: string } | null
export type { AiSettingsView } from './ai-service-settings'
export type AiOutputView = { mode: string; text: string; selectedText: string; path: string } | null
type Command = (id: string) => void

const menus: { label: string; items: { label: string; command: string; hint?: string; divider?: boolean }[] }[] = [
  { get label() { return t("文件") }, items: [
    { get label() { return t("新建文件") }, command: 'newFile' }, { get label() { return t("上传文件") }, command: 'upload' },
    { get label() { return t("保存") }, command: 'save', hint: 'Ctrl+S', divider: true }, { get label() { return t("设置主文件") }, command: 'setMain' },
    { get label() { return t("下载 PDF") }, command: 'downloadPdf', divider: true }, { get label() { return t("导出项目 ZIP") }, command: 'exportZip' },
  ] },
  { get label() { return t("编辑") }, items: [
    { get label() { return t("撤销") }, command: 'undo', hint: 'Ctrl+Z' }, { get label() { return t("重做") }, command: 'redo', hint: 'Ctrl+Y' },
    { get label() { return t("当前文件查找") }, command: 'find', hint: 'Ctrl+F', divider: true }, { get label() { return t("全项目搜索") }, command: 'panel:search' },
    { get label() { return t("添加评论") }, command: 'comment', divider: true },
  ] },
  { get label() { return t("视图") }, items: [
    { get label() { return t("拆分视图") }, command: 'layout:split' }, { get label() { return t("仅编辑器") }, command: 'layout:editor' },
    { get label() { return t("仅 PDF") }, command: 'layout:pdf' }, { get label() { return t("在新标签页打开 PDF") }, command: 'pdfTab' },
    { get label() { return t("定位源码到 PDF") }, command: 'sync:forward', hint: 'Ctrl+Alt+J', divider: true },
    { get label() { return t("显示或隐藏侧栏") }, command: 'toggleSidebar', divider: true }, { get label() { return t("展开或收起编译日志") }, command: 'toggleLogs' },
  ] },
  { get label() { return t("项目") }, items: [
    { get label() { return t("全部项目") }, command: 'home' }, { get label() { return t("新建项目") }, command: 'newProject' },
    { get label() { return t("导入 ZIP 项目") }, command: 'importZip' }, { get label() { return t("导入 GitHub 私有仓库") }, command: 'cloneProject' }, { get label() { return t("重命名项目") }, command: 'rename', divider: true },
    { get label() { return t("历史记录") }, command: 'panel:history' }, { get label() { return t("Git 集成") }, command: 'panel:integrations' },
    { get label() { return t("删除项目") }, command: 'deleteProject', divider: true },
  ] },
  { get label() { return t("帮助") }, items: [
    { get label() { return t("快捷键") }, command: 'shortcuts' }, { get label() { return t("帮助文档") }, command: 'help' },
    { get label() { return t("关于 TeXloom") }, command: 'about' },
  ] },
]

export function WorkspaceMenuBar({ onCommand }: { onCommand: Command }) {
  const [open, setOpen] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="workspace-menu-bar" ref={root} aria-label={t("工作区菜单")}>
    {menus.map(menu => <div className="workspace-menu-group" key={menu.label}>
      <button className={`workspace-menu-trigger ${open === menu.label ? 'active' : ''}`} aria-expanded={open === menu.label} aria-haspopup="menu" onClick={() => setOpen(open === menu.label ? null : menu.label)}>{menu.label}</button>
      {open === menu.label && <div className="workspace-menu-popover" role="menu" aria-label={menu.label}>
        {menu.items.map(item => <button key={item.command} className={item.divider ? 'with-divider' : ''} role="menuitem" onClick={() => { setOpen(null); onCommand(item.command) }}><span>{item.label}</span>{item.hint && <kbd>{item.hint}</kbd>}</button>)}
      </div>}
    </div>)}
  </div>
}

const headingChoices = ['正文', '节', '小节', '三级标题', '段落', '子段落']
const imageChoices = ['从本机上传', '从项目文件中选择', '从其他项目中选择', '从 URL 添加']
const tableChoices = ['选择行列数', '从文本生成', '从图片生成']

export function EditorToolbar({ onCommand }: { onCommand: Command }) {
  const [open, setOpen] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const button = (label: string, id: string, icon: React.ReactNode) => <button className="editor-tool" title={label} aria-label={label} onClick={() => onCommand(id)}>{icon}</button>
  const dropdown = (label: string, id: string, icon: React.ReactNode, choices: string[], prefix: string) => <div className="editor-tool-group" key={id}>
    <button className={`editor-tool ${open === id ? 'active' : ''}`} title={label} aria-label={label} aria-expanded={open === id} aria-haspopup="menu" onClick={() => setOpen(open === id ? null : id)}>{icon}<ChevronDown size={12} /></button>
    {open === id && <div className="editor-tool-popover" role="menu" aria-label={label}>{choices.map((choice, index) => <button key={choice} role="menuitem" onClick={() => { setOpen(null); onCommand(`${prefix}:${index}`) }}>{choice}</button>)}</div>}
  </div>
  return <div className="editor-toolbar" ref={root} role="toolbar" aria-label={t("LaTeX 编辑工具栏")}>
    {button(t("AI 助手"), 'panel:ai', <Bot size={17} />)}<span className="tool-divider" />
    {button(t("撤销"), 'undo', <Undo2 size={17} />)}{button(t("重做"), 'redo', <Redo2 size={17} />)}{button(t("定位到 PDF（Ctrl+Alt+J）"), 'sync:forward', <LocateFixed size={17} />)}<span className="tool-divider" />
    {dropdown(t("文本样式"), 'style', <Heading size={17} />, headingChoices.map(label => t(label)), 'style')}
    {button(t("加粗"), 'bold', <Bold size={16} />)}{button(t("高亮"), 'highlight', <Highlighter size={16} />)}{button(t("斜体"), 'italic', <Italic size={16} />)}<span className="tool-divider" />
    {button(t("插入数学公式"), 'insert:math', <Sigma size={18} />)}
    {dropdown(t("插入符号"), 'symbol', <Omega size={17} />, [t("希腊字母"), t("数学运算符"), t("关系符号"), t("箭头")], 'symbol')}
    {button(t("插入链接"), 'insert:link', <Link2 size={17} />)}{button(t("添加评论"), 'comment', <MessageSquare size={17} />)}
    {button(t("交叉引用"), 'insert:reference', <Tag size={17} />)}{button(t("文献引用"), 'insert:citation', <BookOpen size={17} />)}
    {dropdown(t("插入图片"), 'image', <ImagePlus size={17} />, imageChoices.map(label => t(label)), 'image')}
    {dropdown(t("插入表格"), 'table', <Table2 size={17} />, tableChoices.map(label => t(label)), 'table')}
    {dropdown(t("插入列表"), 'list', <List size={17} />, [t("无序列表"), t("有序列表")], 'list')}
    {dropdown(t("更多工具"), 'more', <MoreHorizontal size={18} />, [t("自定义提示词"), t("翻译选中文本"), t("解释选中文本")], 'more')}
  </div>
}

const panelTabs: { id: PanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'files', get label() { return t("文件与大纲") }, icon: <FileText size={19} /> },
  { id: 'search', get label() { return t("全项目搜索") }, icon: <Search size={19} /> },
  { id: 'review', get label() { return t("审阅") }, icon: <MessageSquare size={19} /> },
  { id: 'history', get label() { return t("历史记录") }, icon: <FileClock size={19} /> },
  { id: 'integrations', get label() { return t("Git 集成") }, icon: <GitBranch size={19} /> },
  { id: 'ai', get label() { return t("AI 助手") }, icon: <Sparkles size={19} /> },
  { id: 'agent', label: 'Agent CLI', icon: <TerminalSquare size={19} /> },
  { id: 'settings', get label() { return t("设置") }, icon: <Settings2 size={19} /> },
]

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="panel-empty"><span>{icon}</span><strong>{title}</strong><p>{description}</p></div>
}

function savedGitAuthor(): { name: string; email: string } {
  try {
    const value = JSON.parse(localStorage.getItem('texloom:git-author') || '{}') as { name?: string; email?: string }
    return { name: typeof value.name === 'string' ? value.name : '', email: typeof value.email === 'string' ? value.email : '' }
  } catch { return { name: '', email: '' } }
}

export function WorkspaceSidebar({ project, files, activePath, activePanel, onAgentGetSelection, onAgentBeforeRun, onAgentApplied, outline, activeOutlineLine, searchHits, searchBusy, searchError, reviewThreads, snapshots, gitState, gitFeedback, aiSettings, aiOutput, aiBusy, aiError, editorFontSize, editorWrap, autoCompile, appearance, highlightColor, onHighlightColor, onPanelChange, onCommand, onOpenFile, onDeleteFile, onNavigate, onSearch, onReplaceAll, onAddReview, onReviewAction, onCreateSnapshot, onRestoreSnapshot, onDeleteSnapshot, onGitAction, onGitBranchChange, onReviewReload, onAiRequest, onAiApply, onAiCancel, onSaveAiSettings, onEditorPreferences, onAutoCompile, onAppearanceChange, onPackageEnsureSaved, onPackageSelectedText, onPackageApplied }: {
  project: WorkspaceProject; files: WorkspaceFile[]; activePath: string; activePanel: PanelId | null; onAgentGetSelection: () => AgentSourceSelection | null; onAgentBeforeRun: () => Promise<boolean>; onAgentApplied: (paths: string[]) => void;
  outline: OutlineEntry[]; activeOutlineLine: number; searchHits: SearchHit[]; searchBusy: boolean; searchError: string;
  reviewThreads: ReviewThread[]; snapshots: Snapshot[]; gitState: GitState | null; gitFeedback: GitFeedback;
  aiSettings: AiSettingsView; aiOutput: AiOutputView; aiBusy: boolean; aiError: string;
  editorFontSize: number; editorWrap: 'on' | 'off'; autoCompile: boolean; appearance: Appearance; highlightColor: string; onHighlightColor: (color: string) => void;
  onPanelChange: (panel: PanelId | null) => void; onCommand: Command; onOpenFile: (path: string) => void; onDeleteFile: (path: string) => void;
  onNavigate: (file: string, line: number, column?: number) => void; onSearch: (options: SearchOptions) => void;
  onReplaceAll: (replacement: string, options: SearchOptions) => void;
  onAddReview: (type: 'comment' | 'suggestion') => void; onReviewAction: (id: string, action: 'reply' | 'resolve' | 'reopen' | 'accept' | 'reject', body?: string) => void;
  onCreateSnapshot: (note: string) => void; onRestoreSnapshot: (id: string) => void;
  onDeleteSnapshot: (snapshot: Snapshot) => void;
  onGitAction: (action: 'init' | 'commit' | 'remote' | 'push' | 'pull', payload?: { message?: string; name?: string; email?: string; url?: string }) => Promise<boolean>;
  onGitBranchChange: (name: string, create: boolean, from?: string) => Promise<boolean>; onReviewReload: () => Promise<void>;
  onAiRequest: (mode: string, prompt: string) => void; onAiApply: () => void; onAiCancel: () => void;
  onSaveAiSettings: (settings: AiSettingsInput) => void;
  onEditorPreferences: (fontSize: number, wrap: 'on' | 'off') => void; onAutoCompile: (value: boolean) => void; onAppearanceChange: (value: Appearance) => void;
  onPackageEnsureSaved: () => Promise<boolean>; onPackageSelectedText: () => string; onPackageApplied: (file: string, content: string) => void;
}) {
  const [search, setSearch] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [reviewScope, setReviewScope] = useState<'file' | 'project'>('file')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiSection, setAiSection] = useState<'writing' | 'packages'>('writing')
  const [settingsSection, setSettingsSection] = useState<'appearance' | 'editing' | 'ai' | 'agent' | 'privacy'>('appearance')
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [replacement, setReplacement] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [snapshotNote, setSnapshotNote] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [gitName, setGitName] = useState(() => savedGitAuthor().name)
  const [gitEmail, setGitEmail] = useState(() => savedGitAuthor().email)
  useEffect(() => {
    const saved = savedGitAuthor()
    setGitName(saved.name || gitState?.authorName || '')
    setGitEmail(saved.email || gitState?.authorEmail || '')
  }, [project.id, gitState?.authorName, gitState?.authorEmail])
  const commitChanges = async () => {
    const name = gitName.trim()
    const email = gitEmail.trim()
    if (!(await onGitAction('commit', { message: commitMessage.trim(), name, email }))) return
    localStorage.setItem('texloom:git-author', JSON.stringify({ name, email }))
    setCommitMessage('')
  }
  const searchOptions = { query: search, caseSensitive, wholeWord, regex }
  const visibleFiles = files.filter(file => {
    const parts = file.path.split('/')
    return parts.slice(0, -1).every((_, index) => !collapsedDirs.has(parts.slice(0, index + 1).join('/')))
  })
  const toggleDirectory = (path: string) => setCollapsedDirs(previous => {
    const next = new Set(previous)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })
  const label = panelTabs.find(tab => tab.id === activePanel)?.label
  const showMikuBackground = appearance.theme === 'miku'
    && (activePanel === 'files' || activePanel === 'search' || activePanel === 'agent' || activePanel === 'ai')
  const currentOutlineLine = outline.filter(entry => entry.file === activePath && entry.line <= activeOutlineLine).at(-1)?.line
  return <div className="workspace-sidebar">
    <nav className="side-rail" aria-label={t("侧栏功能")}>
      {panelTabs.filter(tab => tab.id !== 'settings').map(tab => <button key={tab.id} title={tab.label} aria-label={tab.label} aria-pressed={activePanel === tab.id} className={activePanel === tab.id ? 'selected' : ''} onClick={() => onPanelChange(activePanel === tab.id ? null : tab.id)}>{tab.icon}</button>)}
      <button title={t("设置")} aria-label={t("设置")} aria-pressed={activePanel === 'settings'} className={activePanel === 'settings' ? 'selected' : ''} onClick={() => onPanelChange(activePanel === 'settings' ? null : 'settings')}><Settings2 size={19} /></button>
    </nav>
    <aside className="side-panel" aria-label={label} data-miku-background={showMikuBackground ? activePanel : undefined} style={{ display: activePanel ? undefined : 'none' }}>
      {showMikuBackground && <img className="miku-sidebar-background" src={mikuSidebarArtwork} alt="" decoding="async" draggable={false} />}
      {activePanel !== 'agent' && <div className="side-panel-header"><strong>{label}</strong><button className="side-icon" title={t("收起侧栏")} aria-label={t("收起侧栏")} onClick={() => onPanelChange(null)}><X size={17} /></button></div>}
      <AgentConsole visible={activePanel === 'agent'} projectId={project.id} files={files} activePath={activePath} onGetSelection={onAgentGetSelection} onBeforeRun={onAgentBeforeRun} onApplied={onAgentApplied} onSettings={() => { setSettingsSection('agent'); onPanelChange('settings') }} onClose={() => onPanelChange(null)} />
      {activePanel === 'files' && <div className="files-panel">
        <div className="panel-project"><span className="project-avatar">{project.name.slice(0, 1)}</span><div><strong title={project.name}>{project.name}</strong><small>{t("主文件：")}{project.mainFile}</small></div></div>
        <div className="panel-section-head"><strong>{t("文件树")}</strong><div><button className="side-icon" title={t("新建文件")} aria-label={t("新建文件")} onClick={() => onCommand('newFile')}><FilePlus2 size={16} /></button><button className="side-icon" title={t("上传文件")} aria-label={t("上传文件")} onClick={() => onCommand('upload')}><Upload size={16} /></button></div></div>
        <div className="panel-file-list">{visibleFiles.map(item => <div className={`panel-file-row ${item.path === activePath ? 'active' : ''}`} key={item.path}>
          <button title={item.path} onClick={() => item.type === 'file' ? onOpenFile(item.path) : toggleDirectory(item.path)} style={{ paddingLeft: 11 + (item.path.split('/').length - 1) * 13 }}>{item.type === 'directory' && <ChevronRight size={12} className={collapsedDirs.has(item.path) ? '' : 'open'} />}{item.type === 'directory' ? <Folder size={16} /> : item.path.endsWith('.tex') ? <FileText size={16} /> : <File size={16} />}<span>{item.path.split('/').at(-1)}</span>{item.path === project.mainFile && <small>{t("主")}</small>}</button>
          {item.type === 'file' && item.path !== project.mainFile && <button className="file-row-more" aria-label={t("删除 {0}", item.path)} title={t("删除文件")} onClick={() => onDeleteFile(item.path)}><X size={13} /></button>}
        </div>)}</div>
        <button className="outline-heading" aria-expanded={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}><ChevronRight size={15} className={outlineOpen ? 'open' : ''} />{t("文档大纲")}</button>
        {outlineOpen && (outline.length ? <div className="outline-list">{outline.map((item, index) => <button className={item.file === activePath && item.line === currentOutlineLine ? "active" : ""} key={`${item.file}:${item.line}:${index}`} title={`${item.file}:${item.line}`} style={{ paddingLeft: 10 + (item.level - 1) * 12 }} onClick={() => onNavigate(item.file, item.line)}><span>{item.title}</span><small>{item.line}</small></button>)}</div> : <EmptyState icon={<Heading size={23} />} title={t("暂无标题")} description={t("使用标题命令后，这里会显示文档大纲。")} />)}
      </div>}
      {activePanel === 'search' && <div className="side-panel-content"><form className="search-form" onSubmit={event => { event.preventDefault(); onSearch(searchOptions) }}><label htmlFor="project-search">{t("搜索项目文件")}</label><div className="search-row"><input id="project-search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("输入关键词")} /><button type="submit" disabled={!search.trim() || searchBusy}>{searchBusy ? t("搜索中") : t("搜索")}</button></div></form><div className="search-options"><button className={caseSensitive ? 'active' : ''} aria-pressed={caseSensitive} title={t("区分大小写")} onClick={() => setCaseSensitive(!caseSensitive)}>Aa</button><button className={wholeWord ? 'active' : ''} aria-pressed={wholeWord} title={t("全词匹配")} onClick={() => setWholeWord(!wholeWord)}>W</button><button className={regex ? 'active' : ''} aria-pressed={regex} title={t("正则表达式")} onClick={() => setRegex(!regex)}>.*</button></div><div className="replace-row"><input aria-label={t("替换内容")} value={replacement} onChange={event => setReplacement(event.target.value)} placeholder={t("替换为…")} /><button disabled={!searchHits.length || searchBusy} onClick={() => onReplaceAll(replacement, searchOptions)}>{t("全部替换")}</button></div>{searchError && <div className="search-error" role="alert">{searchError}</div>}{searchHits.length ? <div className="search-results"><strong>{searchHits.length}{" " + t("个匹配")}{searchHits.length >= 500 ? t("（仅显示前 500 个）") : ''}</strong>{searchHits.map((hit, index) => <button key={`${hit.file}:${hit.line}:${hit.column}:${index}`} onClick={() => onNavigate(hit.file, hit.line, hit.column)}><small>{hit.file}:{hit.line}:{hit.column}</small><span>{hit.preview}</span></button>)}</div> : <EmptyState icon={<Search size={24} />} title={t("暂无搜索结果")} description={t("输入关键词搜索项目中的文本文件。")} />}</div>}
      {activePanel === 'review' && <div className="side-panel-content"><div className="panel-tabs"><button className={reviewScope === 'file' ? 'active' : ''} onClick={() => setReviewScope('file')}>{t("当前文件")}</button><button className={reviewScope === 'project' ? 'active' : ''} onClick={() => setReviewScope('project')}>{t("项目概览")}</button></div><button className="panel-action" onClick={() => onAddReview('comment')}><Plus size={15} />{t("添加评论")}</button><button className="panel-action" onClick={() => onAddReview('suggestion')}><Code2 size={15} />{t("提出修改建议")}</button>{reviewThreads.filter(thread => reviewScope === 'project' || thread.file === activePath).length ? <div className="review-list">{reviewThreads.filter(thread => reviewScope === 'project' || thread.file === activePath).map(thread => <div className="review-card" key={thread.id}><button className="review-location" onClick={() => onNavigate(thread.file, thread.line, thread.column)}>{thread.file}:{thread.line} · {thread.type === 'suggestion' ? t("修改建议") : t("评论")}</button>{thread.author && <small className="review-origin">{t("署名：")}{thread.author}</small>}{thread.target?.branch && <small className="review-origin">{t("来自") + " "}{thread.target.branch}</small>}{thread.locationStale && <small className="review-stale" title={t("源码内容已变化，行号可能不准确；接受建议时仍会校验原文")}>{t("源码已变化，定位需核对")}</small>}<span className={`review-status ${thread.status}`}>{thread.status === 'open' ? t("待处理") : thread.status === 'resolved' ? t("已解决") : thread.status === 'accepted' ? t("已接受") : t("已拒绝")}</span><p>{thread.body}</p>{thread.original && <pre>{t("原文：")}{thread.original}</pre>}{thread.proposed !== undefined && <pre>{t("建议：")}{thread.proposed}</pre>}{thread.replies.map(reply => <p className="review-reply" key={reply.id}>↳ {reply.author ? `${reply.author}：` : ""}{reply.body}</p>)}<div className="review-actions">{thread.status === 'open' && <><button onClick={() => onReviewAction(thread.id, 'resolve')}>{t("解决")}</button>{thread.type === 'suggestion' && <><button onClick={() => onReviewAction(thread.id, 'accept')}>{t("接受")}</button><button onClick={() => onReviewAction(thread.id, 'reject')}>{t("拒绝")}</button></>}</>}{thread.status === 'resolved' && <button onClick={() => onReviewAction(thread.id, 'reopen')}>{t("重新打开")}</button>}</div><form onSubmit={event => { event.preventDefault(); const body = replyDrafts[thread.id]?.trim(); if (body) { onReviewAction(thread.id, 'reply', body); setReplyDrafts(previous => ({ ...previous, [thread.id]: '' })) } }}><input value={replyDrafts[thread.id] ?? ''} onChange={event => setReplyDrafts(previous => ({ ...previous, [thread.id]: event.target.value }))} placeholder={t("回复…")} /><button disabled={!replyDrafts[thread.id]?.trim()}>{t("发送")}</button></form></div>)}</div> : <EmptyState icon={<MessageSquare size={24} />} title={t("暂无评论或建议")} description={t("选择源码后可发起审阅。")} />}</div>}
      {activePanel === 'history' && <div className="side-panel-content">
        <div className="history-create">
          <input value={snapshotNote} onChange={event => setSnapshotNote(event.target.value)} placeholder={t("快照说明（可选）")} aria-label={t("快照说明")} />
          <button type="button" onClick={() => { onCreateSnapshot(snapshotNote); setSnapshotNote('') }}><Plus size={14} />{t("创建快照")}</button>
        </div>
        <p className="history-policy">{t("自动仅保留最近 {0} 个，手动不限", automaticSnapshotLimit)}</p>
        {snapshots.length ? <div className="history-list">{snapshots.map(item => <div className="history-card" key={item.id}>
          <div className="history-card-title">
            <strong>{item.kind === "automatic" || item.note === "手动快照" ? t(item.note) : item.note}</strong>
            <span className="history-kind" data-kind={item.kind}>{item.kind === 'automatic' ? t("自动") : t("手动")}</span>
          </div>
          <small>{new Date(item.createdAt).toLocaleString(getLanguage())} · {item.fileCount}{" " + t("个文件")}</small>
          <div className="history-card-actions">
            <button type="button" onClick={() => onRestoreSnapshot(item.id)}>{t("恢复此版本")}</button>
            <button type="button" className="history-delete" aria-label={t("删除快照") + item.note} onClick={() => onDeleteSnapshot(item)}>{t("删除")}</button>
          </div>
        </div>)}</div> : <EmptyState icon={<FileClock size={24} />} title={t("暂无历史记录")} description={t("创建快照以保存当前项目版本。")} />}
      </div>}
      {activePanel === 'integrations' && <div className="side-panel-content"><div className="panel-card"><GitBranch size={22} /><strong>{t("本地 Git")}</strong>{!gitState?.initialized ? <><p>{t("将当前项目初始化为 Git 仓库。")}</p><button onClick={() => onGitAction('init')}>{t("初始化仓库")}</button></> : <><p>{t("分支：")}{gitState.branch || t("未创建提交")}<br />{gitState.status ? t("未提交改动：{0} 项", gitState.status.split(/\r?\n/).length) : t("工作区干净")}</p><div className="git-form"><input value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder={t("提交说明")} /><input value={gitName} onChange={event => setGitName(event.target.value)} placeholder={t("提交者姓名")} /><input value={gitEmail} onChange={event => setGitEmail(event.target.value)} placeholder={t("提交者邮箱")} /><button disabled={!commitMessage.trim() || !gitName.trim() || !gitEmail.trim()} onClick={() => void commitChanges()}>{t("提交改动")}</button></div></>}</div>{gitState?.initialized && <><GitRemotePanel projectId={project.id} state={gitState} feedback={gitFeedback} onAction={onGitAction} /><GitCollaborationPanel projectId={project.id} state={gitState} onSwitch={onGitBranchChange} onReload={onReviewReload} /><div className="git-commits"><strong>{t("最近提交")}</strong>{gitState.commits.length ? gitState.commits.map(commit => <div key={commit.id}><span>{commit.message}</span><small>{commit.shortId} · {new Date(commit.date).toLocaleString(getLanguage())}</small></div>) : <p>{t("暂无提交")}</p>}</div></>}</div>}
      {activePanel === 'ai' && <div className="side-panel-content ai-panel"><div className="ai-section-tabs" role="tablist" aria-label={t("AI 工具")}><button role="tab" aria-selected={aiSection === 'writing'} className={aiSection === 'writing' ? 'active' : ''} onClick={() => setAiSection('writing')}>{t("写作助手")}</button><button role="tab" aria-selected={aiSection === 'packages'} className={aiSection === 'packages' ? 'active' : ''} onClick={() => setAiSection('packages')}>{t("宏包建议")}</button></div>{aiSection === 'writing' ? <><div className="ai-quick-actions"><button onClick={() => onAiRequest('translate', aiPrompt)}>{t("翻译选区")}</button><button onClick={() => onAiRequest('polish', aiPrompt)}>{t("润色选区")}</button><button onClick={() => onAiRequest('explain', aiPrompt)}>{t("解释报错")}</button><button onClick={() => onAiRequest('rewrite', aiPrompt)}>{t("改写选区")}</button><button onClick={() => onAiRequest('formula', aiPrompt)}>{t("生成公式")}</button><button onClick={() => onAiRequest('table', aiPrompt)}>{t("生成表格")}</button><button onClick={() => onAiRequest('custom', aiPrompt)}>{t("自定义指令")}</button></div>{aiOutput ? <div className="ai-result"><strong>{t("AI 结果 ·") + " "}{aiOutput.mode}</strong>{aiOutput.selectedText && <><small>{t("原文")}</small><pre>{aiOutput.selectedText}</pre></>}<small>{t("生成内容")}</small><pre>{aiOutput.text || (aiBusy ? t("正在生成…") : t("暂无内容"))}</pre>{aiError && <p role="alert">{aiError}</p>}<div>{aiBusy ? <button onClick={onAiCancel}>{t("停止生成")}</button> : <>{!['chat', 'explain'].includes(aiOutput.mode) && <button disabled={!aiOutput.text || aiOutput.path !== activePath} onClick={onAiApply}>{t("预览并应用")}</button>}</>}</div></div> : <EmptyState icon={<Bot size={25} />} title={t("AI 写作助手")} description={t("可对选中的 LaTeX 提问，并在应用前预览修改。")} />}{aiError && !aiOutput && <p className="ai-error" role="alert">{aiError}</p>}<form className="ai-input" onSubmit={event => { event.preventDefault(); if (aiPrompt.trim()) onAiRequest('chat', aiPrompt) }}><textarea value={aiPrompt} onChange={event => setAiPrompt(event.target.value)} placeholder={t("向 AI 提问，或写下改写要求…")} rows={3} /><div><button type="button" onClick={() => onPanelChange('settings')}>{aiSettings.configured ? t("API 已配置") : t("配置 API")}</button><button type="submit" disabled={!aiPrompt.trim() || aiBusy}>{t("发送")}</button></div></form></> : <PackageAdvicePanel projectId={project.id} aiConfigured={aiSettings.configured} ensureSaved={onPackageEnsureSaved} getSelectedText={onPackageSelectedText} onApplied={onPackageApplied} openSettings={() => onPanelChange('settings')} />}</div>}
      {activePanel === 'settings' && <div className="side-panel-content settings-panel">
        <nav className="settings-sections" aria-label={t("设置分类")}>{([['appearance', t("外观")], ['editing', t("编辑与编译")], ['ai', 'AI API'], ['agent', 'Agent CLI'], ['privacy', t("数据与隐私")]] as const).map(([id, label]) => <button key={id} className={settingsSection === id ? 'active' : ''} onClick={() => setSettingsSection(id)}>{label}</button>)}</nav>
        {settingsSection === 'appearance' && <><AppearanceSettings value={appearance} onChange={onAppearanceChange} /><label>{t("高亮颜色")}<select value={highlightColor} onChange={event => onHighlightColor(event.target.value)}>{highlightColors.map(color => <option key={color.latex} value={color.latex}>{t(color.label)} · {color.latex}</option>)}</select></label></>}
        {settingsSection === 'editing' && <><strong>{t("编辑器与编译")}</strong><label>{t("编辑器字号")}<select value={editorFontSize} onChange={event => onEditorPreferences(Number(event.target.value), editorWrap)}>{[11,12,13,14,15,16,18,20,22,24].map(size => <option key={size} value={size}>{size} px</option>)}</select></label><label className="settings-checkbox"><input type="checkbox" checked={editorWrap === 'on'} onChange={event => onEditorPreferences(editorFontSize, event.target.checked ? 'on' : 'off')} />{t("自动换行")}</label><label className="settings-checkbox"><input type="checkbox" checked={autoCompile} onChange={event => onAutoCompile(event.target.checked)} />{t("自动编译")}</label><p>{t("大型项目可关闭自动编译，按“编译 PDF”手动生成预览。")}</p></>}
        {settingsSection === 'ai' && <AiServiceSettings value={aiSettings} onSave={onSaveAiSettings} />}
        {settingsSection === 'agent' && <AgentProfileSettings projectId={project.id} />}
        {settingsSection === 'privacy' && <div className="settings-privacy"><strong>{t("本机数据")}</strong><p>{t("项目对话保存在本地 data/agent-sessions。不同 Agent 的对话默认可以共享最近记录；你可以在 Agent CLI 设置中逐账号关闭共享。")}</p><p>{t("Claude Code 的密钥仅保存在本机加密配置中。各 Agent 在项目草稿副本中工作，修改需对照后采纳；Codex CLI 保留原生命令与项目文件操作，写入范围限制在草稿工作区。")}</p></div>}
      </div>}
    </aside>
  </div>
}
