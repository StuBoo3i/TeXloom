import { t } from './i18n'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FileText, Play, RefreshCw, Settings2, TerminalSquare, X } from 'lucide-react'
import { agentApi, providerLabels, type AgentProfile, type AgentSession } from './agent-types'
import { AgentReviewDialog } from './agent-review-dialog'
import './agent-console.css'

const AgentMarkdown = lazy(() => import('./agent-markdown').then(module => ({ default: module.AgentMarkdown })))
const renderedReply = (text: string) => <Suspense fallback={<pre>{text}</pre>}><AgentMarkdown text={text} /></Suspense>
const promptDrafts = new Map<string, string>()

export type AgentSourceSelection = { path: string; start: number; end: number }
type Props = { visible: boolean; projectId: string; files: { path: string; type: 'file' | 'directory' }[]; activePath: string; onGetSelection: () => AgentSourceSelection | null; onBeforeRun: () => Promise<boolean>; onApplied: (paths: string[]) => void; onSettings: () => void; onClose: () => void }
const key = (id: string) => 'texloom:agent-profile:' + id

export function AgentConsole({ visible, projectId, files, activePath, onGetSelection, onBeforeRun, onApplied, onSettings, onClose }: Props) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profileId, setProfileId] = useState(() => localStorage.getItem(key(projectId)) || 'codex-default')
  const [session, setSession] = useState<AgentSession | null>(null)
  const [prompt, setPrompt] = useState(() => promptDrafts.get(projectId) || '')
  const [mode, setMode] = useState<'review' | 'edit'>('review')
  const [selected, setSelected] = useState<string[]>([])
  const [selectionPreview, setSelectionPreview] = useState<AgentSourceSelection | null>(null)
  const [useSelection, setUseSelection] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<{ type: 'tool' | 'text'; text: string }[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [hasReply, setHasReply] = useState(false)
  const [streamIssue, setStreamIssue] = useState('')
  const [runFailed, setRunFailed] = useState(false)
  const [error, setError] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const output = useRef<HTMLDivElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const currentProjectId = useRef(projectId)
  currentProjectId.current = projectId
  const profile = profiles.find(item => item.id === profileId) || profiles[0]
  const ready = !!profile?.status.installed && !!profile.status.authenticated

  async function refresh() {
    try {
      const [items, saved] = await Promise.all([agentApi<AgentProfile[]>('/api/agent/profiles'), agentApi<AgentSession>(`/api/projects/${projectId}/agent/session`)])
      setProfiles(items); setSession(saved)
    } catch (err) { setError(String(err)) }
  }
  useEffect(() => {
    setSelected([])
    setPrompt(promptDrafts.get(projectId) || '')
    setProfileId(localStorage.getItem(key(projectId)) || 'codex-default')
    setSession(null); setError(''); void refresh()
    return () => controller.current?.abort()
  }, [projectId])
  useEffect(() => { setSelectionPreview(null); setUseSelection(false) }, [activePath, projectId])
  useLayoutEffect(() => {
    const viewport = output.current
    const content = transcript.current
    if (!visible || !viewport || !content) return
    followLatest.current = true
    const scrollToLatest = () => {
      if (followLatest.current) viewport.scrollTop = viewport.scrollHeight
    }
    scrollToLatest()
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(content)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [visible, projectId])
  useEffect(() => {
    if (!busy || startedAt === null) return
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [busy, startedAt])
  function updatePrompt(value: string) {
    if (value) promptDrafts.set(projectId, value)
    else promptDrafts.delete(projectId)
    setPrompt(value)
  }
  function selectProfile(id: string) { setProfileId(id); localStorage.setItem(key(projectId), id) }
  async function login() {
    if (!profile) return
    try { await agentApi(`/api/agent/profiles/${profile.id}/login`, 'POST'); setError(t("登录终端已打开；完成登录后刷新状态。")) }
    catch (err) { setError(String(err)) }
  }
  async function run() {
    if (!profile || !prompt.trim() || busy) return
    const submittedPrompt = prompt
    const selection = useSelection ? onGetSelection() : null
    if (!(await onBeforeRun()) || currentProjectId.current !== projectId) return
    followLatest.current = true
    if (output.current) output.current.scrollTop = output.current.scrollHeight
    updatePrompt('')
    setSelectionPreview(selection)
    setBusy(true); setError(''); setStreamIssue(''); setRunFailed(false); setActivity([]); setHasReply(false); setElapsedSeconds(0); setStartedAt(Date.now())
    const abort = new AbortController(); controller.current = abort
    let receivedComplete = false
    let accepted = false
    let latestIssue = ''
    try {
      const response = await fetch(`/api/projects/${projectId}/agent/run`, { method: 'POST', headers: { 'X-TeXloom-Agent': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: profile.provider, profileId: profile.id, mode, prompt: submittedPrompt, files: selected, ...(selection ? { selection } : {}) }), signal: abort.signal })
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { message?: string; error?: string }; throw new Error(body.message || body.error || t("运行失败（{0}）", response.status)) }
      if (!response.body) throw new Error(t("Agent 没有返回事件流"))
      accepted = true
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ''
        for (const event of events) {
          const data = event.split(/\r?\n/).find(line => line.startsWith('data:'))?.slice(5).trim(); if (!data) continue
          const item = JSON.parse(data) as { type: string; text?: string; code?: number; error?: string; changed?: string[]; session?: AgentSession }
          if ((item.type === 'tool' || item.type === 'text') && item.text) {
            if (item.type === 'text') { setHasReply(true); setStreamIssue('') }
            setActivity(old => [...old.slice(-24), { type: item.type as 'tool' | 'text', text: item.text! }])
          }
          if (item.type === 'error') { latestIssue = item.text || t("连接异常"); setStreamIssue(latestIssue) }
          if (item.type === 'failed') { latestIssue = item.text || t("运行失败"); setRunFailed(true); setError(latestIssue) }
          if (item.type === 'complete') {
            receivedComplete = true
            if (item.session) setSession(item.session)
            if (item.changed?.length) onApplied(item.changed)
            if (item.code === 0) {
              setError(''); setStreamIssue(''); setRunFailed(false)
            }
            else { setRunFailed(true); setError(item.error || latestIssue || t("{0} 运行失败", providerLabels[profile.provider])) }
          }
        }
      }
      if (!receivedComplete) throw new Error(t("Agent 事件流提前结束，本次回复可能不完整"))
    } catch (err) {
      if (!accepted && !promptDrafts.has(projectId)) {
        promptDrafts.set(projectId, submittedPrompt)
        if (currentProjectId.current === projectId) setPrompt(submittedPrompt)
      }
      setError(abort.signal.aborted ? t("已停止本次运行") : String(err))
    }
    finally { controller.current = null; setBusy(false); setStartedAt(null); void refresh() }
  }
  return <section className="agent-console" aria-label={t("Agent CLI 功能区")} style={{ display: visible ? undefined : 'none' }}>
    <header className="agent-console-head"><div><TerminalSquare size={16}/><strong>Agent CLI</strong></div><div><button title={t("Agent CLI 设置")} onClick={onSettings}><Settings2 size={15}/></button><button title={t("刷新状态")} onClick={() => void refresh()}><RefreshCw size={15}/></button><button title={t("关闭")} onClick={onClose}><X size={16}/></button></div></header>
    <div className="agent-profile-bar"><label>{t("服务商与账号")}<select value={profile?.id || ''} onChange={event => selectProfile(event.target.value)}>{profiles.map(item => <option key={item.id} value={item.id}>{providerLabels[item.provider]} · {t(item.label)}</option>)}</select></label><span className={ready ? 'agent-ready' : 'agent-offline'}>{!profile?.status.installed ? t("未安装") : ready ? t("可运行") : t("待配置")}</span></div>
    <div className="agent-profile-note">{profile ? t(profile.status.detail) : t("正在检测 CLI…")}{profile?.status.account?.email && <small> · {profile.status.account.email}</small>}{profile?.shareContext && <small> {" " + t("· 共享最近 {0} 轮", profile.contextTurns)}</small>}{profile?.provider === 'codex' && <small>{" " + t("· 独立草稿 · 修改需审阅采纳")}</small>}</div>
    {!ready && <div className="agent-setup">{profile?.status.installed && profile.provider !== 'claude' && <button onClick={() => void login()}>{t("打开系统终端登录")}</button>}<button onClick={onSettings}>{t("账号设置")}</button></div>}
    <div className="agent-transcript" ref={output} onScroll={event => {
      const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
      if (clientHeight) followLatest.current = scrollHeight - scrollTop - clientHeight <= 24
    }}>
      <div className="agent-transcript-content" ref={transcript}>
        {!session?.messages.length && <p className="agent-empty">{t("自由提问；Agent 可自行查看工作副本中的项目文件。修改先进入草稿，审阅采纳后再写回项目。")}</p>}
        {session?.messages.map(message => <div className={`agent-message ${message.role}`} key={message.id}><strong>{message.role === 'user' ? t("你") : message.role === 'system' ? t("项目操作") : providerLabels[message.provider]} <small>{t(profiles.find(item => item.id === message.profileId)?.label || message.profileId)}{message.model ? ' · ' + message.model : ''}{message.status === 'partial' ? t("· 未完成的回复") : ''}</small></strong>{message.role === 'assistant' ? renderedReply(message.text) : <pre>{message.text}</pre>}</div>)}
        {busy && <div className="agent-activity" role="status" aria-live="polite"><strong>{runFailed ? t("请求未完成") : streamIssue ? t("连接重试中") : hasReply ? t("回复中") : t("等待模型回复")} · {elapsedSeconds}{" " + t("秒")}</strong><small>{t(streamIssue) || (profile && providerLabels[profile.provider] + t("正在处理当前请求"))}</small>{activity.map((item, index) => item.type === 'tool' ? <pre key={index}>› {item.text}</pre> : <div key={index}>{renderedReply(item.text)}</div>)}</div>}
        {!!session?.pending.length && <div className="agent-pending"><strong>{session.pending.length}{" " + t("个文件在草稿中")}</strong><p>{t("可以继续让当前或其他 Agent 完善。采纳前，原项目保持不变。")}</p><div className="agent-pending-paths">{session.pending.slice(0, 8).map(change => <span key={change.path}>{change.kind === 'created' ? t("新增") : change.kind === 'deleted' ? t("删除") : t("修改")} · {change.path}</span>)}{session.pending.length > 8 && <span>{t("还有 {0} 个文件", session.pending.length - 8)}</span>}</div><div className="agent-pending-actions"><button className="primary" onClick={() => setReviewOpen(true)}><FileText size={14}/>{t("查看差异并采纳")}</button></div></div>}
        {error && <p className="agent-error" role="alert">{t(error)}</p>}
      </div>
    </div>
    <div className="agent-input"><div className="agent-input-options">{profile?.provider === 'codex' ? <span className="agent-input-mode-label">{t("自由对话 · 独立草稿")}</span> : <select aria-label={t("运行模式")} value={mode} onChange={event => setMode(event.target.value as 'review' | 'edit')}><option value="review">{t("分析建议 · 不应用修改")}</option><option value="edit">{t("修改文件 · 先预览")}</option></select>}<button onClick={() => setShowFiles(!showFiles)}>{t("已选 {0} 个文件", selected.length)}</button><button onClick={() => setSelected(activePath ? [activePath] : [])}>{t("当前文件")}</button><button type="button" className={useSelection ? 'has-selection' : ''} title={t("点击后将当前编辑器选区附在下一条消息中")} onPointerEnter={() => setSelectionPreview(onGetSelection())} onFocus={() => setSelectionPreview(onGetSelection())} onClick={() => { const next = onGetSelection(); setSelectionPreview(next); setUseSelection(Boolean(next) && !useSelection) }}>{t("使用选区")}{useSelection && selectionPreview ? t(" · {0} 字", selectionPreview.end - selectionPreview.start) : ''}</button></div>
      {showFiles && <div className="agent-file-picker">{files.filter(item => item.type === 'file').slice(0, 500).map(file => <label key={file.path}><input type="checkbox" checked={selected.includes(file.path)} onChange={event => setSelected(old => event.target.checked ? [...old, file.path].slice(0, 20) : old.filter(path => path !== file.path))}/>{file.path}</label>)}</div>}
      <form onSubmit={event => { event.preventDefault(); void run() }}><textarea value={prompt} onChange={event => updatePrompt(event.target.value)} placeholder={t("询问当前项目，或描述希望修改的 LaTeX 文件…")} rows={3}/><button className="primary" type={busy ? 'button' : 'submit'} onClick={busy ? () => controller.current?.abort() : undefined} disabled={!busy && (!ready || !prompt.trim())}>{busy ? <X size={14}/> : <Play size={14}/>}{busy ? t("停止") : t("发送")}</button></form>
    </div>
    {reviewOpen && <AgentReviewDialog projectId={projectId} onClose={() => setReviewOpen(false)} onApplied={onApplied} onRefresh={refresh} onBeforeApply={onBeforeRun} />}
  </section>
}
