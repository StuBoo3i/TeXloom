import { useEffect, useState } from 'react'
import { GitBranch, LoaderCircle, RefreshCw } from 'lucide-react'
import type { GitState } from './workspace-ui'
import './git-collaboration-panel.css'

type Branches = { current: string; local: string[]; remote: string[] }
type BranchView = { branch: string; commit: string; files: string[] }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data
}
const post = (body?: unknown): RequestInit => ({ method: 'POST', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })

export function GitCollaborationPanel({ projectId, state, onSwitch, onReload }: { projectId: string; state: GitState; onSwitch: (name: string, create: boolean, from?: string) => Promise<boolean>; onReload: () => Promise<void> }) {
  const [branches, setBranches] = useState<Branches>({ current: '', local: [], remote: [] })
  const [newBranch, setNewBranch] = useState('')
  const [base, setBase] = useState('')
  const [selected, setSelected] = useState('')
  const [view, setView] = useState<BranchView | null>(null)
  const [preview, setPreview] = useState<{ path: string; content: string; diff?: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [author, setAuthor] = useState('')

  const load = async () => setBranches(await request<Branches>(`/api/projects/${projectId}/git/branches`))
  useEffect(() => {
    setBranches({ current: '', local: [], remote: [] })
    setSelected(''); setBase(''); setView(null); setPreview(null)
    setMessage(''); setMessageError(false)
    void load().catch(error => { setMessageError(true); setMessage(error.message) })
  }, [projectId, state.branch, state.remote])
  useEffect(() => { void request<{ name: string }>(`/api/projects/${projectId}/review/author`).then(data => setAuthor(data.name)).catch(() => {}) }, [projectId])

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label); setMessage(''); setMessageError(false)
    try { await operation(); setMessage(previous => previous || `${label}成功`) }
    catch (error) { setMessageError(true); setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }

  const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(state.remote) ?? /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(state.remote)
  const main = branches.remote.includes('main') ? 'main' : branches.remote.includes('master') ? 'master' : branches.remote[0]
  const prUrl = github && main && branches.current !== main ? `https://github.com/${github[1]}/${github[2]}/compare/${encodeURIComponent(main)}...${encodeURIComponent(branches.current)}?expand=1` : ''

  return <div className="panel-card git-collaboration">
    <GitBranch size={22} /><strong>私有仓库协作</strong>
    <p>每位协作者使用自己的 GitHub 身份。当前分支：{branches.current || '—'}</p>
    <div className="git-collab-actions"><button disabled={!!busy || !state.remote} onClick={() => void run('连接 GitHub', async () => { await request(`/api/projects/${projectId}/git/fetch`, post()); await load(); setMessage(`已连接 ${github ? `${github[1]}/${github[2]}` : 'GitHub'}，远程分支已更新`) })}>{busy === '连接 GitHub' ? <LoaderCircle size={13} className="spin" /> : null}连接 GitHub</button><button disabled={!!busy || !state.remote} onClick={() => void run('获取分支', async () => { await request(`/api/projects/${projectId}/git/fetch`, post()); await load() })}><RefreshCw size={13} />获取分支</button></div>
    {message && <p className={`git-collab-message${messageError ? ' error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
    <label>切换分支<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">选择本地或远程分支</option>{[...new Set([...branches.local, ...branches.remote])].filter(name => name !== branches.current).map(name => <option key={name} value={name}>{name}{branches.local.includes(name) ? '' : '（远程）'}</option>)}</select></label>
    <button disabled={!!busy || !selected} onClick={() => void run('切换分支', async () => { if (await onSwitch(selected, false)) { await load(); setSelected('') } else throw new Error('切换分支失败') })}>切换并编辑</button>
    <label>新分支名称<input value={newBranch} onChange={event => setNewBranch(event.target.value)} placeholder="feature/姓名/主题" /></label>
    <label>基于<select value={base} onChange={event => setBase(event.target.value)}><option value="">当前分支</option>{branches.remote.map(name => <option key={name} value={name}>origin/{name}</option>)}</select></label>
    <button disabled={!!busy || !newBranch.trim()} onClick={() => void run('创建分支', async () => { if (await onSwitch(newBranch.trim(), true, base || undefined)) { await load(); setNewBranch('') } else throw new Error('创建分支失败') })}>创建并切换</button>
    {prUrl && <a className="git-collab-link" href={prUrl} target="_blank" rel="noreferrer">在 GitHub 发起 Pull Request ↗</a>}
    <div className="git-collab-divider" />
    <strong>远程分支只读查看</strong>
    <label>分支<select value={view?.branch ?? ''} onChange={event => void run('读取分支', async () => { const name = event.target.value; setPreview(null); setView(name ? await request<BranchView>(`/api/projects/${projectId}/git/branch-view?branch=${encodeURIComponent(name)}`) : null) })}><option value="">选择远程分支</option>{branches.remote.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    {view && <div className="git-branch-files">{view.files.filter(file => /\.(tex|bib|sty|cls|md|txt)$/i.test(file)).slice(0, 100).map(file => <button key={file} onClick={() => void run('读取文件', async () => { setPreview(await request<{ path: string; content: string }>(`/api/projects/${projectId}/git/branch-view?branch=${encodeURIComponent(view.branch)}&path=${encodeURIComponent(file)}`)) })}>{file}</button>)}</div>}
    {preview && <><div className="git-collab-actions"><button onClick={() => void run('查看差异', async () => { if (!view) return; const result = await request<{ diff: string }>(`/api/projects/${projectId}/git/branch-view?branch=${encodeURIComponent(view.branch)}&path=${encodeURIComponent(preview.path)}&diff=1`); setPreview(previous => previous ? { ...previous, diff: result.diff } : null) })}>与当前分支比较</button></div><pre className="git-branch-preview" title={preview.path}>{preview.diff === undefined ? preview.content : preview.diff || '此文件与当前分支相同'}</pre></>}
    <div className="git-collab-divider" />
    <strong>审阅记录</strong><p>评论和建议存放在独立的 texloom-reviews 分支，仓库协作者均可读取；源码分支保持整洁。</p>
    <label>本机审阅署名<input value={author} maxLength={100} onChange={event => setAuthor(event.target.value)} placeholder="例如：Alice" /></label>
    <div className="git-collab-actions"><button disabled={!!busy || !author.trim()} onClick={() => void run('保存署名', async () => { await request(`/api/projects/${projectId}/review/author`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: author.trim() }) }) })}>保存署名</button>
    <button disabled={!!busy || !state.remote} onClick={() => void run('同步审阅', async () => { const result = await request<{ threads: number; pending: number }>(`/api/projects/${projectId}/git/review-sync`, post()); await onReload(); setMessage(`同步完成：${result.threads} 条审阅，待发送 ${result.pending} 条`) })}>同步审阅记录</button></div>
  </div>
}
