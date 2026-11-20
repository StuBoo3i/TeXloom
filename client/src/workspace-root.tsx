import { useState } from 'react'
import { Check, FolderOpen, HardDrive, X } from 'lucide-react'
import './workspace-root.css'

export type WorkspaceInfo = { root: string; defaultRoot: string; configured: boolean; projectRoot: string | null; projectPath: string | null }
type Choice = 'current' | 'default' | 'selected'

async function request<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data
}

export function WorkspaceRootDialog({ info, firstProject, onClose, onConfigured }: { info: WorkspaceInfo; firstProject: boolean; onClose: () => void; onConfigured: () => void }) {
  const [choice, setChoice] = useState<Choice>('current')
  const [selected, setSelected] = useState<{ token: string; path: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const chosenPath = choice === 'default' ? info.defaultRoot : choice === 'selected' ? selected?.path : info.root

  async function browse() {
    setBusy('正在打开文件夹选择器…'); setError('')
    try {
      const result = await request<{ token?: string; path?: string; cancelled?: boolean }>('/api/workspace/select', {})
      if (result.token && result.path) { setSelected({ token: result.token, path: result.path }); setChoice('selected') }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }

  async function confirm() {
    setBusy('正在保存根目录…'); setError('')
    try {
      await request('/api/workspace/root', { choice, token: choice === 'selected' ? selected?.token : undefined })
      onConfigured()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="workspace-root-dialog" role="dialog" aria-modal="true" aria-label="选择项目根目录">
      <div className="workspace-root-heading"><span className="workspace-root-icon"><HardDrive size={22} /></span><button aria-label="关闭" onClick={onClose} disabled={!!busy}><X size={18} /></button></div>
      <h2>{firstProject ? '选择项目根目录' : '修改项目根目录'}</h2>
      <p>{firstProject ? '首次创建项目，请确认新项目保存的位置。TeXloom 已准备好默认目录。' : '更换后，新建或导入的项目会保存在所选目录；已有项目仍可在原位置打开。'}</p>
      <div className="workspace-root-choices">
        <button type="button" className={choice === 'current' ? 'selected' : ''} onClick={() => setChoice('current')}><span><strong>当前根目录</strong><small>{info.root}</small></span>{choice === 'current' && <Check size={17} />}</button>
        {info.defaultRoot !== info.root && <button type="button" className={choice === 'default' ? 'selected' : ''} onClick={() => setChoice('default')}><span><strong>恢复默认目录</strong><small>{info.defaultRoot}</small></span>{choice === 'default' && <Check size={17} />}</button>}
        {selected && <button type="button" className={choice === 'selected' ? 'selected' : ''} onClick={() => setChoice('selected')}><span><strong>指定目录</strong><small>{selected.path}</small></span>{choice === 'selected' && <Check size={17} />}</button>}
      </div>
      <button type="button" className="workspace-root-browse" onClick={() => void browse()} disabled={!!busy}><FolderOpen size={17} />选择其他文件夹…</button>
      <div className="workspace-root-selected"><span>新项目将保存到</span><strong title={chosenPath}>{chosenPath}</strong></div>
      {error && <div className="workspace-root-error" role="alert">{error}</div>}
      <div className="workspace-root-actions"><button type="button" className="outline-button" onClick={onClose} disabled={!!busy}>取消</button><button type="button" className="primary-button" onClick={() => void confirm()} disabled={!!busy || !chosenPath}>{busy || (firstProject ? '确认并继续' : '保存根目录')}</button></div>
    </div>
  </div>
}
