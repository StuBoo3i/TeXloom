import { useEffect, useState } from 'react'
import { BookOpen, Check, ExternalLink, PackagePlus, Sparkles, X } from 'lucide-react'
import './package-advice-panel.css'

type Suggestion = { key: string; title: string; reason: string; installed: boolean; ctanUrl: string; source: 'local' | 'ai'; note?: string }
type Advice = { suggestions: Suggestion[]; sourceHash: string }
type Preview = { key: string; mainFile: string; sourceHash: string; line: number; insertion: string }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function PackageAdvicePanel({ projectId, aiConfigured, ensureSaved, getSelectedText, onApplied, openSettings }: {
  projectId: string
  aiConfigured: boolean
  ensureSaved: () => Promise<boolean>
  getSelectedText: () => string
  onApplied: (file: string, content: string) => void
  openSettings: () => void
}) {
  const [goal, setGoal] = useState('')
  const [includeLog, setIncludeLog] = useState(true)
  const [advice, setAdvice] = useState<Advice | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => { setAdvice(null); setPreview(null); setError(''); setMessage('') }, [projectId])
  async function analyze(ai: boolean) {
    if (busy) return
    setBusy(ai ? 'AI 正在分析…' : '正在分析…'); setError(''); setMessage(''); setPreview(null)
    try {
      if (!(await ensureSaved())) throw new Error('请先保存当前文件')
      const url = `/api/projects/${projectId}/package-advice`
      const result = ai
        ? await request<Advice>(`${url}/ai`, post({ goal: goal.trim(), selectedText: getSelectedText().slice(0, 3000), includeLog }))
        : await request<Advice>(`${url}?goal=${encodeURIComponent(goal.trim())}`)
      setAdvice(result)
      if (!result.suggestions.length) setMessage('没有发现匹配的宏包；可补充具体需求或选中相关源码后使用 AI 分析。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }
  async function showPreview(key: string) {
    setBusy('正在读取导言区…'); setError('')
    try {
      if (!(await ensureSaved())) throw new Error('请先保存当前文件')
      setPreview(await request<Preview>(`/api/projects/${projectId}/package-preview?key=${encodeURIComponent(key)}`))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }
  async function apply() {
    if (!preview) return
    setBusy('正在加入宏包…'); setError('')
    try {
      if (!(await ensureSaved())) throw new Error('请先保存当前文件')
      const result = await request<{ mainFile: string; content: string }>(`/api/projects/${projectId}/package-apply`, post({ key: preview.key, expectedHash: preview.sourceHash }))
      onApplied(result.mainFile, result.content)
      setAdvice(previous => previous ? { ...previous, suggestions: previous.suggestions.map(item => item.key === preview.key ? { ...item, installed: true } : item) } : null)
      setMessage(`已在 ${result.mainFile} 加入 ${preview.insertion.trim()}；请编译 PDF 验证当前 Tectonic 环境。`)
      setPreview(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }

  return <div className="package-advice">
    <div className="package-advice-intro"><PackagePlus size={22} /><strong>LaTeX 宏包建议</strong><p>结合项目导言区、你的目标与编译日志，找出适合的宏包。推荐不等于兼容保证，添加后请编译验证。</p></div>
    <label className="package-goal">你想完成什么？<textarea value={goal} onChange={event => setGoal(event.target.value)} rows={3} maxLength={1000} placeholder="例如：制作三线表、排版多行公式、插入子图…" /></label>
    <label className="package-log"><input type="checkbox" checked={includeLog} onChange={event => setIncludeLog(event.target.checked)} />AI 分析时附带最近编译日志</label>
    <div className="package-advice-actions"><button onClick={() => void analyze(false)} disabled={!!busy}><BookOpen size={14} />本地分析</button><button onClick={() => aiConfigured ? void analyze(true) : openSettings()} disabled={!!busy}><Sparkles size={14} />{aiConfigured ? 'AI 分析' : '配置 AI'}</button></div>
    <small className="package-privacy">只有点击 AI 分析才发送需求、选中源码、最多 12 KB 导言区及勾选的日志；API Key 仅由本机后端读取。</small>
    {busy && <p className="package-status" role="status">{busy}</p>}{error && <p className="package-error" role="alert">{error}</p>}{message && <p className="package-status" role="status">{message}</p>}
    {advice && <div className="package-list"><strong>{advice.suggestions.length} 项建议 · {advice.suggestions[0]?.source === 'ai' ? 'AI 分析' : '本地规则'}</strong>{advice.suggestions.map(item => <article key={item.key} className="package-card"><div><code>{item.key}</code><span>{item.installed ? <><Check size={12} />已加载</> : '待验证'}</span></div><h3>{item.title}</h3><p>{item.reason}</p>{item.note && <small>{item.note}</small>}<div className="package-card-actions"><a href={item.ctanUrl} target="_blank" rel="noopener noreferrer">CTAN 资料 <ExternalLink size={12} /></a>{!item.installed && <button disabled={!!busy} onClick={() => void showPreview(item.key)}>预览并添加</button>}</div></article>)}</div>}
    {preview && <div className="package-preview" role="dialog" aria-label="预览宏包修改"><div><strong>确认修改导言区</strong><button aria-label="关闭预览" onClick={() => setPreview(null)}><X size={15} /></button></div><p>{preview.mainFile} · 约第 {preview.line} 行，在 <code>\begin{'{document}'}</code> 前加入：</p><pre><span>+</span> {preview.insertion}</pre><small>此操作仅修改主文件。宏包加载顺序可能影响现有设置，请在添加后检查源码并编译。</small><div className="package-preview-actions"><button onClick={() => setPreview(null)}>取消</button><button disabled={!!busy} onClick={() => void apply()}>确认添加</button></div></div>}
  </div>
}
