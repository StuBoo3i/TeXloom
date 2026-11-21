import { useEffect, useRef, useState } from 'react'
import { BookOpen, Bold, Bot, Braces, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Columns2, Download, File, FileClock, FilePlus2, FileText, Folder, GitBranch, Heading, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, LocateFixed, MessageSquare, MoreHorizontal, Omega, Paperclip, Plus, Redo2, Search, Settings2, Sigma, Sparkles, Table2, Tag, Undo2, Upload, X } from 'lucide-react'
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
import type { Appearance } from './appearance'
import { highlightColors } from './highlight'

export type PanelId = 'files' | 'search' | 'review' | 'history' | 'integrations' | 'ai' | 'settings'
export type WorkspaceFile = { path: string; type: 'file' | 'directory'; size?: number }
export type WorkspaceProject = { id: string; name: string; mainFile: string }
export type ReviewThread = { id: string; file: string; line: number; column: number; original: string; body: string; author?: string; proposed?: string; type: 'comment' | 'suggestion'; status: 'open' | 'resolved' | 'accepted' | 'rejected'; createdAt: string; replies: { id: string; body: string; author?: string; createdAt: string }[]; target?: { branch: string; commit: string; blob: string }; locationStale?: boolean }
export type Snapshot = { id: string; note: string; createdAt: string; fileCount: number }
export type GitState = { initialized: boolean; branch: string; remote: string; status: string; commits: { id: string; shortId: string; date: string; message: string }[]; authorName?: string; authorEmail?: string }
export type GitFeedback = { action: 'push' | 'pull'; status: 'running' | 'success' | 'error'; message: string } | null
export type AiSettingsView = { configured: boolean; model: string; maxOutputTokens: number; timeoutSeconds: number }
export type AiOutputView = { mode: string; text: string; selectedText: string; path: string } | null
type Command = (id: string) => void

const menus: { label: string; items: { label: string; command: string; hint?: string; divider?: boolean }[] }[] = [
  { label: '文件', items: [
    { label: '新建文件', command: 'newFile' }, { label: '上传文件', command: 'upload' },
    { label: '保存', command: 'save', hint: 'Ctrl+S', divider: true }, { label: '设置主文件', command: 'setMain' },
    { label: '下载 PDF', command: 'downloadPdf', divider: true }, { label: '导出项目 ZIP', command: 'exportZip' },
  ] },
  { label: '编辑', items: [
    { label: '撤销', command: 'undo', hint: 'Ctrl+Z' }, { label: '重做', command: 'redo', hint: 'Ctrl+Y' },
    { label: '当前文件查找', command: 'find', hint: 'Ctrl+F', divider: true }, { label: '全项目搜索', command: 'panel:search' },
    { label: '添加评论', command: 'comment', divider: true },
  ] },
  { label: '视图', items: [
    { label: '拆分视图', command: 'layout:split' }, { label: '仅编辑器', command: 'layout:editor' },
    { label: '仅 PDF', command: 'layout:pdf' }, { label: '在新标签页打开 PDF', command: 'pdfTab' },
    { label: '定位源码到 PDF', command: 'sync:forward', hint: 'Ctrl+Alt+J', divider: true },
    { label: '显示或隐藏侧栏', command: 'toggleSidebar', divider: true }, { label: '展开或收起编译日志', command: 'toggleLogs' },
  ] },
  { label: '项目', items: [
    { label: '全部项目', command: 'home' }, { label: '新建项目', command: 'newProject' },
    { label: '导入 ZIP 项目', command: 'importZip' }, { label: '导入 GitHub 私有仓库', command: 'cloneProject' }, { label: '重命名项目', command: 'rename', divider: true },
    { label: '历史记录', command: 'panel:history' }, { label: 'Git 集成', command: 'panel:integrations' },
    { label: '删除项目', command: 'deleteProject', divider: true },
  ] },
  { label: '帮助', items: [
    { label: '快捷键', command: 'shortcuts' }, { label: '帮助文档', command: 'help' },
    { label: '关于 TeXloom', command: 'about' },
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
  return <div className="workspace-menu-bar" ref={root} aria-label="工作区菜单">
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
  return <div className="editor-toolbar" ref={root} role="toolbar" aria-label="LaTeX 编辑工具栏">
    {button('AI 助手', 'panel:ai', <Bot size={17} />)}<span className="tool-divider" />
    {button('撤销', 'undo', <Undo2 size={17} />)}{button('重做', 'redo', <Redo2 size={17} />)}{button('定位到 PDF（Ctrl+Alt+J）', 'sync:forward', <LocateFixed size={17} />)}<span className="tool-divider" />
    {dropdown('文本样式', 'style', <Heading size={17} />, headingChoices, 'style')}
    {button('加粗', 'bold', <Bold size={16} />)}{button('高亮', 'highlight', <Highlighter size={16} />)}{button('斜体', 'italic', <Italic size={16} />)}<span className="tool-divider" />
    {button('插入数学公式', 'insert:math', <Sigma size={18} />)}
    {dropdown('插入符号', 'symbol', <Omega size={17} />, ['希腊字母', '数学运算符', '关系符号', '箭头'], 'symbol')}
    {button('插入链接', 'insert:link', <Link2 size={17} />)}{button('添加评论', 'comment', <MessageSquare size={17} />)}
    {button('交叉引用', 'insert:reference', <Tag size={17} />)}{button('文献引用', 'insert:citation', <BookOpen size={17} />)}
    {dropdown('插入图片', 'image', <ImagePlus size={17} />, imageChoices, 'image')}
    {dropdown('插入表格', 'table', <Table2 size={17} />, tableChoices, 'table')}
    {dropdown('插入列表', 'list', <List size={17} />, ['无序列表', '有序列表'], 'list')}
    {dropdown('更多工具', 'more', <MoreHorizontal size={18} />, ['自定义提示词', '翻译选中文本', '解释选中文本'], 'more')}
  </div>
}

const panelTabs: { id: PanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'files', label: '文件与大纲', icon: <FileText size={19} /> },
  { id: 'search', label: '全项目搜索', icon: <Search size={19} /> },
  { id: 'review', label: '审阅', icon: <MessageSquare size={19} /> },
  { id: 'history', label: '历史记录', icon: <FileClock size={19} /> },
  { id: 'integrations', label: 'Git 集成', icon: <GitBranch size={19} /> },
  { id: 'ai', label: 'AI 助手', icon: <Sparkles size={19} /> },
  { id: 'settings', label: '设置', icon: <Settings2 size={19} /> },
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

export function WorkspaceSidebar({ project, files, activePath, activePanel, outline, activeOutlineLine, searchHits, searchBusy, searchError, reviewThreads, snapshots, gitState, gitFeedback, aiSettings, aiOutput, aiBusy, aiError, editorFontSize, editorWrap, autoCompile, appearance, highlightColor, onHighlightColor, onPanelChange, onCommand, onOpenFile, onDeleteFile, onNavigate, onSearch, onReplaceAll, onAddReview, onReviewAction, onCreateSnapshot, onRestoreSnapshot, onGitAction, onGitBranchChange, onReviewReload, onAiRequest, onAiApply, onAiCancel, onSaveAiSettings, onEditorPreferences, onAutoCompile, onAppearanceChange, onPackageEnsureSaved, onPackageSelectedText, onPackageApplied }: {
  project: WorkspaceProject; files: WorkspaceFile[]; activePath: string; activePanel: PanelId | null;
  outline: OutlineEntry[]; activeOutlineLine: number; searchHits: SearchHit[]; searchBusy: boolean; searchError: string;
  reviewThreads: ReviewThread[]; snapshots: Snapshot[]; gitState: GitState | null; gitFeedback: GitFeedback;
  aiSettings: AiSettingsView; aiOutput: AiOutputView; aiBusy: boolean; aiError: string;
  editorFontSize: number; editorWrap: 'on' | 'off'; autoCompile: boolean; appearance: Appearance; highlightColor: string; onHighlightColor: (color: string) => void;
  onPanelChange: (panel: PanelId | null) => void; onCommand: Command; onOpenFile: (path: string) => void; onDeleteFile: (path: string) => void;
  onNavigate: (file: string, line: number, column?: number) => void; onSearch: (options: SearchOptions) => void;
  onReplaceAll: (replacement: string, options: SearchOptions) => void;
  onAddReview: (type: 'comment' | 'suggestion') => void; onReviewAction: (id: string, action: 'reply' | 'resolve' | 'reopen' | 'accept' | 'reject', body?: string) => void;
  onCreateSnapshot: (note: string) => void; onRestoreSnapshot: (id: string) => void;
  onGitAction: (action: 'init' | 'commit' | 'remote' | 'push' | 'pull', payload?: { message?: string; name?: string; email?: string; url?: string }) => Promise<boolean>;
  onGitBranchChange: (name: string, create: boolean, from?: string) => Promise<boolean>; onReviewReload: () => Promise<void>;
  onAiRequest: (mode: string, prompt: string) => void; onAiApply: () => void; onAiCancel: () => void;
  onSaveAiSettings: (settings: { apiKey?: string; clearKey?: boolean; model: string; maxOutputTokens: number; timeoutSeconds: number }) => void;
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
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-flash')
  const [maxOutputTokens, setMaxOutputTokens] = useState(2048)
  const [timeoutSeconds, setTimeoutSeconds] = useState(90)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [replacement, setReplacement] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [snapshotNote, setSnapshotNote] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [gitName, setGitName] = useState(() => savedGitAuthor().name)
  const [gitEmail, setGitEmail] = useState(() => savedGitAuthor().email)
  useEffect(() => { setModel(aiSettings.model); setMaxOutputTokens(aiSettings.maxOutputTokens); setTimeoutSeconds(aiSettings.timeoutSeconds) }, [aiSettings])
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
  const currentOutlineLine = outline.filter(entry => entry.file === activePath && entry.line <= activeOutlineLine).at(-1)?.line
  return <div className="workspace-sidebar">
    <nav className="side-rail" aria-label="侧栏功能">
      {panelTabs.map(tab => <button key={tab.id} title={tab.label} aria-label={tab.label} aria-pressed={activePanel === tab.id} className={activePanel === tab.id ? 'selected' : ''} onClick={() => onPanelChange(activePanel === tab.id ? null : tab.id)}>{tab.icon}</button>)}
    </nav>
    {activePanel && <aside className="side-panel" aria-label={label}>
      <div className="side-panel-header"><strong>{label}</strong><button className="side-icon" title="收起侧栏" aria-label="收起侧栏" onClick={() => onPanelChange(null)}><X size={17} /></button></div>
      {activePanel === 'files' && <div className="files-panel">
        <div className="panel-project"><span className="project-avatar">{project.name.slice(0, 1)}</span><div><strong title={project.name}>{project.name}</strong><small>主文件：{project.mainFile}</small></div></div>
        <div className="panel-section-head"><strong>文件树</strong><div><button className="side-icon" title="新建文件" aria-label="新建文件" onClick={() => onCommand('newFile')}><FilePlus2 size={16} /></button><button className="side-icon" title="上传文件" aria-label="上传文件" onClick={() => onCommand('upload')}><Upload size={16} /></button></div></div>
        <div className="panel-file-list">{visibleFiles.map(item => <div className={`panel-file-row ${item.path === activePath ? 'active' : ''}`} key={item.path}>
          <button title={item.path} onClick={() => item.type === 'file' ? onOpenFile(item.path) : toggleDirectory(item.path)} style={{ paddingLeft: 11 + (item.path.split('/').length - 1) * 13 }}>{item.type === 'directory' && <ChevronRight size={12} className={collapsedDirs.has(item.path) ? '' : 'open'} />}{item.type === 'directory' ? <Folder size={16} /> : item.path.endsWith('.tex') ? <FileText size={16} /> : <File size={16} />}<span>{item.path.split('/').at(-1)}</span>{item.path === project.mainFile && <small>主</small>}</button>
          {item.type === 'file' && item.path !== project.mainFile && <button className="file-row-more" aria-label={`删除 ${item.path}`} title="删除文件" onClick={() => onDeleteFile(item.path)}><X size={13} /></button>}
        </div>)}</div>
        <button className="outline-heading" aria-expanded={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}><ChevronRight size={15} className={outlineOpen ? 'open' : ''} />文档大纲</button>
        {outlineOpen && (outline.length ? <div className="outline-list">{outline.map((item, index) => <button className={item.file === activePath && item.line === currentOutlineLine ? "active" : ""} key={`${item.file}:${item.line}:${index}`} title={`${item.file}:${item.line}`} style={{ paddingLeft: 10 + (item.level - 1) * 12 }} onClick={() => onNavigate(item.file, item.line)}><span>{item.title}</span><small>{item.line}</small></button>)}</div> : <EmptyState icon={<Heading size={23} />} title="暂无标题" description="使用标题命令后，这里会显示文档大纲。" />)}
      </div>}
      {activePanel === 'search' && <div className="side-panel-content"><form className="search-form" onSubmit={event => { event.preventDefault(); onSearch(searchOptions) }}><label htmlFor="project-search">搜索项目文件</label><div className="search-row"><input id="project-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="输入关键词" /><button type="submit" disabled={!search.trim() || searchBusy}>{searchBusy ? '搜索中' : '搜索'}</button></div></form><div className="search-options"><button className={caseSensitive ? 'active' : ''} aria-pressed={caseSensitive} title="区分大小写" onClick={() => setCaseSensitive(!caseSensitive)}>Aa</button><button className={wholeWord ? 'active' : ''} aria-pressed={wholeWord} title="全词匹配" onClick={() => setWholeWord(!wholeWord)}>W</button><button className={regex ? 'active' : ''} aria-pressed={regex} title="正则表达式" onClick={() => setRegex(!regex)}>.*</button></div><div className="replace-row"><input aria-label="替换内容" value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="替换为…" /><button disabled={!searchHits.length || searchBusy} onClick={() => onReplaceAll(replacement, searchOptions)}>全部替换</button></div>{searchError && <div className="search-error" role="alert">{searchError}</div>}{searchHits.length ? <div className="search-results"><strong>{searchHits.length} 个匹配{searchHits.length >= 500 ? '（仅显示前 500 个）' : ''}</strong>{searchHits.map((hit, index) => <button key={`${hit.file}:${hit.line}:${hit.column}:${index}`} onClick={() => onNavigate(hit.file, hit.line, hit.column)}><small>{hit.file}:{hit.line}:{hit.column}</small><span>{hit.preview}</span></button>)}</div> : <EmptyState icon={<Search size={24} />} title="暂无搜索结果" description="输入关键词搜索项目中的文本文件。" />}</div>}
      {activePanel === 'review' && <div className="side-panel-content"><div className="panel-tabs"><button className={reviewScope === 'file' ? 'active' : ''} onClick={() => setReviewScope('file')}>当前文件</button><button className={reviewScope === 'project' ? 'active' : ''} onClick={() => setReviewScope('project')}>项目概览</button></div><button className="panel-action" onClick={() => onAddReview('comment')}><Plus size={15} />添加评论</button><button className="panel-action" onClick={() => onAddReview('suggestion')}><Code2 size={15} />提出修改建议</button>{reviewThreads.filter(thread => reviewScope === 'project' || thread.file === activePath).length ? <div className="review-list">{reviewThreads.filter(thread => reviewScope === 'project' || thread.file === activePath).map(thread => <div className="review-card" key={thread.id}><button className="review-location" onClick={() => onNavigate(thread.file, thread.line, thread.column)}>{thread.file}:{thread.line} · {thread.type === 'suggestion' ? '修改建议' : '评论'}</button>{thread.author && <small className="review-origin">署名：{thread.author}</small>}{thread.target?.branch && <small className="review-origin">来自 {thread.target.branch}</small>}{thread.locationStale && <small className="review-stale" title="源码内容已变化，行号可能不准确；接受建议时仍会校验原文">源码已变化，定位需核对</small>}<span className={`review-status ${thread.status}`}>{thread.status === 'open' ? '待处理' : thread.status === 'resolved' ? '已解决' : thread.status === 'accepted' ? '已接受' : '已拒绝'}</span><p>{thread.body}</p>{thread.original && <pre>原文：{thread.original}</pre>}{thread.proposed !== undefined && <pre>建议：{thread.proposed}</pre>}{thread.replies.map(reply => <p className="review-reply" key={reply.id}>↳ {reply.author ? `${reply.author}：` : ""}{reply.body}</p>)}<div className="review-actions">{thread.status === 'open' && <><button onClick={() => onReviewAction(thread.id, 'resolve')}>解决</button>{thread.type === 'suggestion' && <><button onClick={() => onReviewAction(thread.id, 'accept')}>接受</button><button onClick={() => onReviewAction(thread.id, 'reject')}>拒绝</button></>}</>}{thread.status === 'resolved' && <button onClick={() => onReviewAction(thread.id, 'reopen')}>重新打开</button>}</div><form onSubmit={event => { event.preventDefault(); const body = replyDrafts[thread.id]?.trim(); if (body) { onReviewAction(thread.id, 'reply', body); setReplyDrafts(previous => ({ ...previous, [thread.id]: '' })) } }}><input value={replyDrafts[thread.id] ?? ''} onChange={event => setReplyDrafts(previous => ({ ...previous, [thread.id]: event.target.value }))} placeholder="回复…" /><button disabled={!replyDrafts[thread.id]?.trim()}>发送</button></form></div>)}</div> : <EmptyState icon={<MessageSquare size={24} />} title="暂无评论或建议" description="选择源码后可发起审阅。" />}</div>}
      {activePanel === 'history' && <div className="side-panel-content"><div className="history-create"><input value={snapshotNote} onChange={event => setSnapshotNote(event.target.value)} placeholder="快照说明（可选）" /><button onClick={() => { onCreateSnapshot(snapshotNote); setSnapshotNote('') }}><Plus size={14} />创建快照</button></div>{snapshots.length ? <div className="history-list">{snapshots.map(item => <div className="history-card" key={item.id}><strong>{item.note}</strong><small>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.fileCount} 个文件</small><button onClick={() => onRestoreSnapshot(item.id)}>恢复此版本</button></div>)}</div> : <EmptyState icon={<FileClock size={24} />} title="暂无历史记录" description="创建快照以保存当前项目版本。" />}</div>}
      {activePanel === 'integrations' && <div className="side-panel-content"><div className="panel-card"><GitBranch size={22} /><strong>本地 Git</strong>{!gitState?.initialized ? <><p>将当前项目初始化为 Git 仓库。</p><button onClick={() => onGitAction('init')}>初始化仓库</button></> : <><p>分支：{gitState.branch || '未创建提交'}<br />{gitState.status ? `未提交改动：${gitState.status.split(/\r?\n/).length} 项` : '工作区干净'}</p><div className="git-form"><input value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="提交说明" /><input value={gitName} onChange={event => setGitName(event.target.value)} placeholder="提交者姓名" /><input value={gitEmail} onChange={event => setGitEmail(event.target.value)} placeholder="提交者邮箱" /><button disabled={!commitMessage.trim() || !gitName.trim() || !gitEmail.trim()} onClick={() => void commitChanges()}>提交改动</button></div></>}</div>{gitState?.initialized && <><GitRemotePanel projectId={project.id} state={gitState} feedback={gitFeedback} onAction={onGitAction} /><GitCollaborationPanel projectId={project.id} state={gitState} onSwitch={onGitBranchChange} onReload={onReviewReload} /><div className="git-commits"><strong>最近提交</strong>{gitState.commits.length ? gitState.commits.map(commit => <div key={commit.id}><span>{commit.message}</span><small>{commit.shortId} · {new Date(commit.date).toLocaleString('zh-CN')}</small></div>) : <p>暂无提交</p>}</div></>}</div>}
      {activePanel === 'ai' && <div className="side-panel-content ai-panel"><div className="ai-section-tabs" role="tablist" aria-label="AI 工具"><button role="tab" aria-selected={aiSection === 'writing'} className={aiSection === 'writing' ? 'active' : ''} onClick={() => setAiSection('writing')}>写作助手</button><button role="tab" aria-selected={aiSection === 'packages'} className={aiSection === 'packages' ? 'active' : ''} onClick={() => setAiSection('packages')}>宏包建议</button></div>{aiSection === 'writing' ? <><div className="ai-quick-actions"><button onClick={() => onAiRequest('translate', aiPrompt)}>翻译选区</button><button onClick={() => onAiRequest('polish', aiPrompt)}>润色选区</button><button onClick={() => onAiRequest('explain', aiPrompt)}>解释报错</button><button onClick={() => onAiRequest('rewrite', aiPrompt)}>改写选区</button><button onClick={() => onAiRequest('formula', aiPrompt)}>生成公式</button><button onClick={() => onAiRequest('table', aiPrompt)}>生成表格</button><button onClick={() => onAiRequest('custom', aiPrompt)}>自定义指令</button></div>{aiOutput ? <div className="ai-result"><strong>AI 结果 · {aiOutput.mode}</strong>{aiOutput.selectedText && <><small>原文</small><pre>{aiOutput.selectedText}</pre></>}<small>生成内容</small><pre>{aiOutput.text || (aiBusy ? '正在生成…' : '暂无内容')}</pre>{aiError && <p role="alert">{aiError}</p>}<div>{aiBusy ? <button onClick={onAiCancel}>停止生成</button> : <>{!['chat', 'explain'].includes(aiOutput.mode) && <button disabled={!aiOutput.text || aiOutput.path !== activePath} onClick={onAiApply}>预览并应用</button>}</>}</div></div> : <EmptyState icon={<Bot size={25} />} title="AI 写作助手" description="可对选中的 LaTeX 提问，并在应用前预览修改。" />}{aiError && !aiOutput && <p className="ai-error" role="alert">{aiError}</p>}<form className="ai-input" onSubmit={event => { event.preventDefault(); if (aiPrompt.trim()) onAiRequest('chat', aiPrompt) }}><textarea value={aiPrompt} onChange={event => setAiPrompt(event.target.value)} placeholder="向 AI 提问，或写下改写要求…" rows={3} /><div><button type="button" onClick={() => onPanelChange('settings')}>{aiSettings.configured ? 'API 已配置' : '配置 API'}</button><button type="submit" disabled={!aiPrompt.trim() || aiBusy}>发送</button></div></form></> : <PackageAdvicePanel projectId={project.id} aiConfigured={aiSettings.configured} ensureSaved={onPackageEnsureSaved} getSelectedText={onPackageSelectedText} onApplied={onPackageApplied} openSettings={() => onPanelChange('settings')} />}</div>}
      {activePanel === 'settings' && <div className="side-panel-content settings-panel"><strong>AI 服务</strong><p>{aiSettings.configured ? '已配置 DeepSeek API Key' : '尚未配置 API Key'}</p><label>DeepSeek API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={aiSettings.configured ? '留空则保持当前密钥' : '输入 API Key'} /></label><label>模型<input value={model} onChange={event => setModel(event.target.value)} /></label><label>单次最大输出 Token<input type="number" min="256" max="8192" value={maxOutputTokens} onChange={event => setMaxOutputTokens(Number(event.target.value))} /></label><label>请求超时（秒）<input type="number" min="10" max="180" value={timeoutSeconds} onChange={event => setTimeoutSeconds(Number(event.target.value))} /></label><p>密钥由本机 Windows 用户加密存储。调用 AI 时，选中的文本和填写的要求会发给 DeepSeek。</p><button className="panel-action" onClick={() => { onSaveAiSettings({ apiKey, model, maxOutputTokens, timeoutSeconds }); setApiKey('') }}>保存 AI 设置</button>{aiSettings.configured && <button className="panel-action" onClick={() => onSaveAiSettings({ clearKey: true, model, maxOutputTokens, timeoutSeconds })}>移除 API Key</button>}<AppearanceSettings value={appearance} onChange={onAppearanceChange} /><label>高亮颜色<select value={highlightColor} onChange={event => onHighlightColor(event.target.value)}>{highlightColors.map(color => <option key={color.latex} value={color.latex}>{color.label} · {color.latex}</option>)}</select></label><strong>编辑器与编译</strong><label>编辑器字号<select value={editorFontSize} onChange={event => onEditorPreferences(Number(event.target.value), editorWrap)}>{[11,12,13,14,15,16,18,20,22,24].map(size => <option key={size} value={size}>{size} px</option>)}</select></label><label className="settings-checkbox"><input type="checkbox" checked={editorWrap === 'on'} onChange={event => onEditorPreferences(editorFontSize, event.target.checked ? 'on' : 'off')} />自动换行</label><label className="settings-checkbox"><input type="checkbox" checked={autoCompile} onChange={event => onAutoCompile(event.target.checked)} />自动编译</label><p>大型项目可关闭自动编译，按“编译 PDF”手动生成预览。</p></div>}
    </aside>}
  </div>
}
