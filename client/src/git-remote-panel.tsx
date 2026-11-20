import { useEffect, useState } from 'react'
import { ChevronDown, Link2, LoaderCircle } from 'lucide-react'
import type { GitFeedback, GitState } from './workspace-ui'
import './git-remote-panel.css'

type GitAction = (action: 'init' | 'commit' | 'remote' | 'push' | 'pull', payload?: { message?: string; name?: string; email?: string; url?: string }) => Promise<boolean>

export function GitRemotePanel({ projectId, state, feedback, onAction }: { projectId: string; state: GitState; feedback: GitFeedback; onAction: GitAction }) {
  const [url, setUrl] = useState(state.remote)
  const [expanded, setExpanded] = useState(!state.remote)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  useEffect(() => { setUrl(state.remote); setExpanded(!state.remote); setLocalError('') }, [projectId, state.remote])
  const syncBusy = busy || feedback?.status === 'running'

  const saveRemote = async (): Promise<boolean> => {
    const value = url.trim()
    if (!value) { setLocalError('请先填写远程仓库地址'); return false }
    setLocalError('')
    const success = await onAction('remote', { url: value })
    if (success) setExpanded(false)
    else setLocalError('远程地址保存失败，请检查地址后重试')
    return success
  }

  const push = async () => {
    if (syncBusy) return
    setBusy(true)
    try {
      if (!state.remote || expanded && url.trim() !== state.remote) {
        if (!(await saveRemote())) return
      }
      await onAction('push')
    } finally { setBusy(false) }
  }

  return <div className="panel-card git-remote-card">
    <Link2 size={22} />
    <div className="git-remote-heading"><strong>远程仓库</strong>{state.remote && <button type="button" className="git-remote-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '修改地址'}<ChevronDown size={13} className={expanded ? 'open' : ''} /></button>}</div>
    <p className="git-remote-current" title={state.remote || undefined}>{state.remote || '尚未配置远程地址'}</p>
    {expanded && <div className="git-form git-remote-form"><input aria-label="远程仓库地址" value={url} onChange={event => setUrl(event.target.value)} placeholder="HTTPS 或 SSH 地址" disabled={syncBusy} /><button type="button" disabled={syncBusy || !url.trim()} onClick={() => void saveRemote()}>保存地址</button></div>}
    <div className="git-sync"><button type="button" disabled={syncBusy || !state.remote} onClick={() => void onAction('pull')}>{feedback?.action === 'pull' && feedback.status === 'running' ? <><LoaderCircle size={13} className="spin" />拉取中</> : '拉取'}</button><button type="button" disabled={syncBusy || !state.remote && !url.trim()} onClick={() => void push()}>{feedback?.action === 'push' && feedback.status === 'running' ? <><LoaderCircle size={13} className="spin" />推送中</> : '推送'}</button></div>
    {localError && <p className="git-sync-status error" role="alert">{localError}</p>}
    {feedback && <p className={`git-sync-status ${feedback.status}`} role={feedback.status === 'error' ? 'alert' : 'status'} aria-live="polite">{feedback.status === 'running' && <LoaderCircle size={13} className="spin" />}{feedback.message}</p>}
  </div>
}
