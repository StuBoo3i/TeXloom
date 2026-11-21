import { useEffect, useRef, useState } from 'react'
import { Check, FileText, Play, RefreshCw, Settings2, TerminalSquare, X } from 'lucide-react'
import { agentApi, providerLabels, type AgentProfile, type AgentSession } from './agent-types'
import './agent-console.css'

export type AgentSourceSelection = { path: string; start: number; end: number }
type Props = { projectId: string; files: { path: string; type: 'file' | 'directory' }[]; activePath: string; onGetSelection: () => AgentSourceSelection | null; onBeforeRun: () => Promise<boolean>; onApplied: (paths: string[]) => void; onSettings: () => void; onClose: () => void }
const key = (id: string) => 'texloom:agent-profile:' + id

export function AgentConsole({ projectId, files, activePath, onGetSelection, onBeforeRun, onApplied, onSettings, onClose }: Props) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profileId, setProfileId] = useState(() => localStorage.getItem(key(projectId)) || 'codex-default')
  const [session, setSession] = useState<AgentSession | null>(null)
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<'review' | 'edit'>('review')
  const [selected, setSelected] = useState<string[]>([])
  const [selectionPreview, setSelectionPreview] = useState<AgentSourceSelection | null>(null)
  const [showFiles, setShowFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<string[]>([])
  const [error, setError] = useState('')
  const output = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  const profile = profiles.find(item => item.id === profileId) || profiles[0]
  const ready = !!profile?.status.installed && !!profile.status.authenticated

  async function refresh() {
    try {
      const [items, saved] = await Promise.all([agentApi<AgentProfile[]>('/api/agent/profiles'), agentApi<AgentSession>(`/api/projects/${projectId}/agent/session`)])
      setProfiles(items); setSession(saved)
    } catch (err) { setError(String(err)) }
  }
  useEffect(() => {
    setSelected(activePath ? [activePath] : [])
    setProfileId(localStorage.getItem(key(projectId)) || 'codex-default')
    setSession(null); setError(''); void refresh()
    return () => controller.current?.abort()
  }, [projectId])
  useEffect(() => { setSelected(activePath ? [activePath] : []) }, [activePath])
  useEffect(() => { setSelectionPreview(null) }, [activePath, projectId])
  useEffect(() => { output.current?.scrollTo({ top: output.current.scrollHeight }) }, [session?.messages.length, activity])
  function selectProfile(id: string) { setProfileId(id); localStorage.setItem(key(projectId), id) }
  async function login() {
    if (!profile) return
    try { await agentApi(`/api/agent/profiles/${profile.id}/login`, 'POST'); setError('登录终端已打开；完成登录后刷新状态。') }
    catch (err) { setError(String(err)) }
  }
  async function run() {
    if (!profile || !prompt.trim() || busy || session?.pending.length) return
    const selection = onGetSelection()
    if (!(await onBeforeRun())) return
    setSelectionPreview(selection)
    setBusy(true); setError(''); setActivity([])
    const abort = new AbortController(); controller.current = abort
    try {
      const response = await fetch(`/api/projects/${projectId}/agent/run`, { method: 'POST', headers: { 'X-TeXloom-Agent': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: profile.provider, profileId: profile.id, mode, prompt, files: selected, ...(selection ? { selection } : {}) }), signal: abort.signal })
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { message?: string; error?: string }; throw new Error(body.message || body.error || `运行失败（${response.status}）`) }
      if (!response.body) throw new Error('Agent 没有返回事件流')
      setPrompt('')
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ''
        for (const event of events) {
          const data = event.split(/\r?\n/).find(line => line.startsWith('data:'))?.slice(5).trim(); if (!data) continue
          const item = JSON.parse(data) as { type: string; text?: string; code?: number; session?: AgentSession }
          if ((item.type === 'tool' || item.type === 'text') && item.text) setActivity(old => [...old.slice(-24), item.type === 'tool' ? '› ' + item.text : item.text!])
          if (item.type === 'error') setError(item.text || '运行失败')
          if (item.type === 'complete') { if (item.session) setSession(item.session); if (item.code !== 0) setError(providerLabels[profile.provider] + ' 运行失败，请检查输出或登录状态。') }
        }
      }
    } catch (err) { setError(abort.signal.aborted ? '已停止本次运行' : String(err)) }
    finally { controller.current = null; setBusy(false); void refresh() }
  }
  async function resolve(action: 'apply' | 'discard') {
    try {
      const result = await agentApi<{ applied?: string[] }>(`/api/projects/${projectId}/agent/${action}`, 'POST')
      await refresh(); if (result.applied) onApplied(result.applied)
    } catch (err) { setError(String(err)) }
  }
  return <section className="agent-console" aria-label="Agent CLI 功能区">
    <header className="agent-console-head"><div><TerminalSquare size={16}/><strong>Agent CLI</strong></div><div><button title="Agent CLI 设置" onClick={onSettings}><Settings2 size={15}/></button><button title="刷新状态" onClick={() => void refresh()}><RefreshCw size={15}/></button><button title="关闭" onClick={onClose}><X size={16}/></button></div></header>
    <div className="agent-profile-bar"><label>服务商与账号<select value={profile?.id || ''} onChange={event => selectProfile(event.target.value)}>{profiles.map(item => <option key={item.id} value={item.id}>{providerLabels[item.provider]} · {item.label}</option>)}</select></label><span className={ready ? 'agent-ready' : 'agent-offline'}>{!profile?.status.installed ? '未安装' : ready ? '可运行' : '待配置'}</span></div>
    <div className="agent-profile-note">{profile?.status.detail || '正在检测 CLI…'}{profile?.shareContext && <small> · 共享最近 {profile.contextTurns} 轮</small>}</div>
    {!ready && <div className="agent-setup">{profile?.status.installed && profile.provider !== 'claude' && <button onClick={() => void login()}>打开系统终端登录</button>}<button onClick={onSettings}>账号设置</button></div>}
    <div className="agent-transcript" ref={output}>
      {!session?.messages.length && <p className="agent-empty">选择项目文件，向 Agent 提问。修改会先显示差异，由你确认后写回。</p>}
      {session?.messages.map(message => <div className={`agent-message ${message.role}`} key={message.id}><strong>{message.role === 'user' ? '你' : message.role === 'system' ? '项目操作' : providerLabels[message.provider]} <small>{profiles.find(item => item.id === message.profileId)?.label || message.profileId}{message.model ? ' · ' + message.model : ''}</small></strong><pre>{message.text}</pre></div>)}
      {busy && <div className="agent-activity"><strong>正在运行 {profile && providerLabels[profile.provider]}…</strong>{activity.map((item, index) => <pre key={index}>{item}</pre>)}</div>}
      {!!session?.pending.length && <div className="agent-pending"><strong>{session.pending.length} 个文件待审阅</strong><p>应用前会再次检查源文件是否变化。</p>{session.pending.map(change => <details key={change.path}><summary><FileText size={14}/>{change.path}</summary><div className="agent-diff"><div><b>原文</b><pre>{change.before}</pre></div><div><b>修改后</b><pre>{change.after}</pre></div></div></details>)}<div className="agent-pending-actions"><button onClick={() => void resolve('discard')}>放弃修改</button><button className="primary" onClick={() => void resolve('apply')}><Check size={14}/>应用修改</button></div></div>}
      {error && <p className="agent-error" role="alert">{error}</p>}
    </div>
    <div className="agent-input"><div className="agent-input-options"><select aria-label="运行模式" value={mode} onChange={event => setMode(event.target.value as 'review' | 'edit')}><option value="review">分析建议 · 不应用修改</option><option value="edit">修改文件 · 先预览</option></select><button onClick={() => setShowFiles(!showFiles)}>已选 {selected.length} 个文件</button><button onClick={() => setSelected(activePath ? [activePath] : [])}>当前文件</button><button type="button" className={selectionPreview ? 'has-selection' : ''} title="发送时自动附带当前选区对应的文件源码；未选中则不附带" onPointerEnter={() => setSelectionPreview(onGetSelection())} onFocus={() => setSelectionPreview(onGetSelection())} onClick={() => setSelectionPreview(onGetSelection())}>使用选区{selectionPreview ? ` · ${selectionPreview.end - selectionPreview.start} 字` : ''}</button></div>
      {showFiles && <div className="agent-file-picker">{files.filter(item => item.type === 'file').slice(0, 500).map(file => <label key={file.path}><input type="checkbox" checked={selected.includes(file.path)} onChange={event => setSelected(old => event.target.checked ? [...old, file.path].slice(0, 20) : old.filter(path => path !== file.path))}/>{file.path}</label>)}</div>}
      <form onSubmit={event => { event.preventDefault(); void run() }}><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="询问当前项目，或描述希望修改的 LaTeX 文件…" rows={3}/><button className="primary" type={busy ? 'button' : 'submit'} onClick={busy ? () => controller.current?.abort() : undefined} disabled={!busy && (!ready || !prompt.trim() || !!session?.pending.length)}>{busy ? <X size={14}/> : <Play size={14}/>}{busy ? '停止' : '发送'}</button></form>
    </div>
  </section>
}
