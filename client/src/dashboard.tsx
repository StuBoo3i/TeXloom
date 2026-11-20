import { useEffect, useMemo, useState } from 'react'
import { Archive, Check, ChevronRight, CloudUpload, FileText, FolderInput, FolderOutput, GitBranch, Layers3, Plus, RefreshCw, Search, Tag, Tags, Users, X } from 'lucide-react'
import './dashboard.css'

export type DashboardProject = { id: string; name: string; mainFile: string; createdAt: string; updatedAt: string; sharing?: 'personal' | 'shared'; archived?: boolean; tags?: string[] }
type FolderChoice = { token?: string; name?: string; cancelled?: boolean }
type ImportPreview = { token: string; name: string; candidates: { name: string; files: number; bytes: number; mainFile: string }[] }
type Filter = 'all' | 'personal' | 'shared' | 'archived' | `tag:${string}`

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function Dashboard({ projects, onOpen, onRefresh, onCreate, onImportZip, onClone }: { projects: DashboardProject[]; onOpen: (project: DashboardProject) => void; onRefresh: () => Promise<void>; onCreate: () => void; onImportZip: () => void; onClone: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [tagMenu, setTagMenu] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { void request<string[]>('/api/project-tags').then(setTags).catch(cause => setError(String(cause))) }, [])
  useEffect(() => { setSelected(previous => new Set([...previous].filter(id => projects.some(item => item.id === id)))) }, [projects])

  const visible = useMemo(() => projects.filter(item => {
    const matches = filter === 'all' || filter === 'archived' ? filter !== 'archived' || item.archived : !item.archived && (filter === 'personal' ? item.sharing !== 'shared' : filter === 'shared' ? item.sharing === 'shared' : item.tags?.includes(filter.slice(4)))
    return matches && (!query.trim() || `${item.name} ${item.mainFile} ${(item.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  }), [projects, filter, query])

  const counts = { all: projects.length, personal: projects.filter(item => !item.archived && item.sharing !== 'shared').length, shared: projects.filter(item => !item.archived && item.sharing === 'shared').length, archived: projects.filter(item => item.archived).length }
  const filterTitle = filter.startsWith('tag:') ? filter.slice(4) : ({ all: '所有项目', personal: '个人项目', shared: '与您共享的项目', archived: '归档项目' } as Record<string, string>)[filter]

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError(''); setMessage('')
    try { await action(); setMessage(previous => previous || `${label}完成`) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }

  const updateProject = (id: string, patch: unknown) => run('更新项目', async () => {
    await request(`/api/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    await onRefresh()
  })

  const createTag = () => run('创建标签', async () => {
    const name = newTag.trim()
    if (!name) return
    await request('/api/project-tags', post({ name }))
    setTags(await request<string[]>('/api/project-tags'))
    setNewTag(''); setAddingTag(false); setFilter(`tag:${name}`)
  })

  const renameTag = (name: string) => {
    const next = window.prompt('标签新名称', name)?.trim()
    if (!next || next === name) return
    void run('重命名标签', async () => {
      await request(`/api/project-tags/${encodeURIComponent(name)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }) })
      setTags(await request<string[]>('/api/project-tags'))
      if (filter === `tag:${name}`) setFilter(`tag:${next}`)
      await onRefresh()
    })
  }

  const removeTag = (name: string) => {
    if (!window.confirm(`删除标签“${name}”？项目文件不会删除。`)) return
    void run('删除标签', async () => {
      await request(`/api/project-tags/${encodeURIComponent(name)}`, { method: 'DELETE' })
      setTags(await request<string[]>('/api/project-tags'))
      if (filter === `tag:${name}`) setFilter('all')
      await onRefresh()
    })
  }

  const chooseImportFolder = () => run('扫描文件夹', async () => {
    const choice = await request<FolderChoice>('/api/folders/select', post({ mode: 'import' }))
    if (choice.cancelled || !choice.token) { setMessage('已取消选择文件夹'); return }
    const result = await request<{ candidates: ImportPreview['candidates'] }>('/api/folders/inspect', post({ token: choice.token }))
    setImportPreview({ token: choice.token, name: choice.name || '所选文件夹', candidates: result.candidates })
  })

  const importFolder = () => run('批量导入', async () => {
    if (!importPreview) return
    const result = await request<{ imported: DashboardProject[]; failed: { name: string; error: string }[] }>('/api/folders/import', post({ token: importPreview.token }))
    setImportPreview(null)
    await onRefresh()
    setFilter('all')
    setMessage(`已导入 ${result.imported.length} 个项目${result.failed.length ? `，失败 ${result.failed.length} 个：${result.failed.map(item => `${item.name}（${item.error}）`).join('；')}` : ''}`)
  })

  const exportFolder = () => run('批量导出', async () => {
    if (!selected.size) throw new Error('请先勾选要导出的项目')
    const choice = await request<FolderChoice>('/api/folders/select', post({ mode: 'export' }))
    if (choice.cancelled || !choice.token) { setMessage('已取消选择文件夹'); return }
    const result = await request<{ exported: { id: string; folder: string }[]; failed: { id: string; error: string }[] }>('/api/folders/export', post({ token: choice.token, projectIds: [...selected] }))
    setMessage(`已导出 ${result.exported.length} 个项目到“${choice.name}”${result.failed.length ? `，失败 ${result.failed.length} 个：${result.failed.map(item => item.error).join('；')}` : ''}`)
  })

  const toggleSelected = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return <div className="dashboard-shell">
    <aside className="dashboard-nav" aria-label="项目分类">
      <div className="dashboard-nav-title">项目空间</div>
      {([
        ['all', '所有项目', <Layers3 size={18} />, counts.all],
        ['personal', '个人项目', <FileText size={18} />, counts.personal],
        ['shared', '与您共享的', <Users size={18} />, counts.shared],
        ['archived', '归档', <Archive size={18} />, counts.archived],
      ] as const).map(([key, label, icon, count]) => <button key={key} className={`dashboard-nav-item ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{icon}<span>{label}</span><small>{count}</small></button>)}
      <div className="dashboard-nav-separator" />
      <div className="dashboard-nav-subtitle"><span>我的标签</span><button title="新建标签" aria-label="新建标签" onClick={() => setAddingTag(value => !value)}><Plus size={17} /></button></div>
      {addingTag && <form className="dashboard-tag-create" onSubmit={event => { event.preventDefault(); void createTag() }}><input autoFocus maxLength={30} value={newTag} onChange={event => setNewTag(event.target.value)} placeholder="标签名称" /><button disabled={!newTag.trim() || !!busy}><Check size={15} /></button></form>}
      {tags.map(name => <div className="dashboard-tag-nav" key={name}><button className={`dashboard-nav-item ${filter === `tag:${name}` ? 'active' : ''}`} onClick={() => setFilter(`tag:${name}`)}><Tag size={16} /><span>{name}</span><small>{projects.filter(item => item.tags?.includes(name)).length}</small></button><button className="dashboard-tag-more" title={`管理标签 ${name}`} onClick={() => setTagMenu(tagMenu === name ? null : name)}>···</button>{tagMenu === name && <div className="dashboard-tag-menu"><button onClick={() => { setTagMenu(null); renameTag(name) }}>重命名</button><button onClick={() => { setTagMenu(null); removeTag(name) }}>删除标签</button></div>}</div>)}
    </aside>
    <main className="dashboard-content">
      <div className="dashboard-welcome"><div><span className="dashboard-eyebrow">TEXLOOM · LOCAL WORKSPACE</span><h1>你的学术项目，井然有序。</h1><p>本地编辑与编译，按项目分类管理；需要协作时连接 GitHub 私有仓库。</p></div><div className="dashboard-welcome-mark"><FileText size={48} strokeWidth={1.2} /></div></div>
      <div className="dashboard-actions"><button className="primary-button" onClick={onCreate}><Plus size={17} />新建项目</button><button className="outline-button" onClick={() => void chooseImportFolder()} disabled={!!busy}><FolderInput size={17} />从本地文件夹批量导入</button><button className="outline-button" onClick={onImportZip}><CloudUpload size={17} />导入 ZIP</button><button className="outline-button" onClick={onClone}><GitBranch size={17} />导入 GitHub</button></div>
      <section className="dashboard-projects"><div className="dashboard-project-heading"><div><span className="section-kicker">WORKSPACE</span><h2>{filterTitle}<small>{visible.length}</small></h2></div><div className="dashboard-project-tools"><label className="dashboard-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目或标签" /></label><button className="dashboard-icon-button" title="刷新项目" onClick={() => void onRefresh()}><RefreshCw size={17} /></button></div></div>
      <div className="dashboard-batch-bar"><label><input type="checkbox" checked={!!visible.length && visible.every(item => selected.has(item.id))} onChange={event => setSelected(previous => { const next = new Set(previous); for (const item of visible) if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} />选择当前列表</label><span>已选 {selected.size} 项</span><button disabled={!selected.size || !!busy} onClick={() => void exportFolder()}><FolderOutput size={16} />导出到本地文件夹</button></div>
      {error && <p className="dashboard-feedback error" role="alert">{error}<button onClick={() => setError('')}><X size={14} /></button></p>}{message && <p className="dashboard-feedback" role="status">{message}<button onClick={() => setMessage('')}><X size={14} /></button></p>}
      {visible.length ? <div className="dashboard-project-grid">{visible.map(item => <article className="dashboard-project-card" key={item.id}><div className="dashboard-card-top"><label title="选择导出"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} /></label><span className={`dashboard-category ${item.sharing === 'shared' ? 'shared' : ''}`}>{item.sharing === 'shared' ? <Users size={12} /> : <FileText size={12} />}{item.sharing === 'shared' ? '共享' : '个人'}</span>{item.archived && <span className="dashboard-category archived">已归档</span>}</div><button className="dashboard-project-open" onClick={() => onOpen(item)}><span className="dashboard-project-icon"><FileText size={22} /></span><strong>{item.name}</strong><small>{item.mainFile}</small><span className="dashboard-project-date">更新于 {new Date(item.updatedAt).toLocaleDateString('zh-CN')}<ChevronRight size={16} /></span></button><div className="dashboard-card-tags">{(item.tags ?? []).map(tag => <span key={tag}>{tag}</span>)}{!(item.tags?.length) && <span className="empty">未设置标签</span>}</div><div className="dashboard-card-actions"><button onClick={() => void updateProject(item.id, { sharing: item.sharing === 'shared' ? 'personal' : 'shared' })}>{item.sharing === 'shared' ? '设为个人' : '设为共享'}</button><button onClick={() => void updateProject(item.id, { archived: !item.archived })}>{item.archived ? '恢复' : '归档'}</button><div className="dashboard-card-tag-picker"><button onClick={() => setTagMenu(tagMenu === `project:${item.id}` ? null : `project:${item.id}`)}><Tags size={14} />标签</button>{tagMenu === `project:${item.id}` && <div className="dashboard-card-tag-menu">{tags.length ? tags.map(tag => <label key={tag}><input type="checkbox" checked={item.tags?.includes(tag) ?? false} onChange={() => void updateProject(item.id, { tags: item.tags?.includes(tag) ? item.tags.filter(value => value !== tag) : [...(item.tags ?? []), tag] })} />{tag}</label>) : <p>先在左侧创建标签</p>}</div>}</div></div></article>)}</div> : <div className="dashboard-empty"><FileText size={34} /><strong>这里还没有项目</strong><p>{query ? '试试其他搜索词。' : '新建项目或从本地文件夹导入。'}</p></div>}</section>
    </main>
    {importPreview && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setImportPreview(null) }}><div className="modal dashboard-import-modal" role="dialog" aria-modal="true" aria-label="确认批量导入"><h2>确认批量导入</h2><p>从“{importPreview.name}”发现 {importPreview.candidates.length} 个 LaTeX 项目。每个项目会复制到独立的本地工作空间。</p><ul>{importPreview.candidates.map(item => <li key={item.name}><strong>{item.name}</strong><small>{item.files} 个文件 · 主文件 {item.mainFile}</small></li>)}</ul><div className="modal-actions"><button className="outline-button" onClick={() => setImportPreview(null)}>取消</button><button className="primary-button" disabled={!!busy} onClick={() => void importFolder()}>{busy ? '导入中…' : '导入全部'}</button></div></div></div>}
  </div>
}
