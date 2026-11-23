import { t } from './i18n'
import { useEffect, useState } from 'react'
import { agentApi, providerLabels, type AgentProfile, type AgentProviderId } from './agent-types'
import './agent-profile-settings.css'

export function AgentProfileSettings({ projectId }: { projectId: string }) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [id, setId] = useState(() => localStorage.getItem('texloom:agent-profile:' + projectId) || 'codex-default')
  const [draft, setDraft] = useState<AgentProfile | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [newProvider, setNewProvider] = useState<AgentProviderId>('codex')
  const [newLabel, setNewLabel] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  async function reload(selectedId = id) {
    try {
      const items = await agentApi<AgentProfile[]>('/api/agent/profiles')
      setProfiles(items)
      const current = items.find(item => item.id === selectedId) || items[0]
      setId(current?.id || '')
      setDraft(current || null)
    } catch (err) { setFeedback(String(err)) }
  }
  useEffect(() => { void reload(localStorage.getItem('texloom:agent-profile:' + projectId) || 'codex-default') }, [projectId])
  function select(value: string) { const item = profiles.find(profile => profile.id === value); setId(value); localStorage.setItem('texloom:agent-profile:' + projectId, value); setDraft(item || null); setApiKey(''); setFeedback('') }
  function change(patch: Partial<AgentProfile>) { setDraft(old => old ? { ...old, ...patch } : old) }
  async function save(clearKey = false) {
    if (!draft) return
    setBusy(true); setFeedback('')
    try {
      await agentApi(`/api/agent/profiles/${draft.id}`, 'PATCH', { label: draft.label, model: draft.model, effort: draft.effort, timeoutSeconds: draft.timeoutSeconds, contextTurns: draft.contextTurns, shareContext: draft.shareContext, ...(apiKey ? { apiKey } : {}), ...(clearKey ? { clearKey: true } : {}) })
      setApiKey(''); await reload(draft.id); setFeedback(t("设置已保存"))
    } catch (err) { setFeedback(String(err)) }
    finally { setBusy(false) }
  }
  async function add() {
    if (!newLabel.trim()) return
    setBusy(true); setFeedback('')
    try {
      const created = await agentApi<AgentProfile>('/api/agent/profiles', 'POST', { provider: newProvider, label: newLabel.trim() })
      setNewLabel(''); localStorage.setItem('texloom:agent-profile:' + projectId, created.id); await reload(created.id); setFeedback(t("账号资料已添加；请完成此账号的登录或密钥配置。"))
    } catch (err) { setFeedback(String(err)) }
    finally { setBusy(false) }
  }
  async function login() {
    if (!draft) return
    try { await agentApi(`/api/agent/profiles/${draft.id}/login`, 'POST'); setFeedback(t("登录终端已打开；完成后点击刷新状态。")) }
    catch (err) { setFeedback(String(err)) }
  }
  return <div className="agent-profile-settings">
    <strong>{t("Agent CLI 账号")}</strong>
    <p>{t("每个项目共用一份对话记录；不同服务商和账号保留各自的原生会话。")}</p>
    <label>{t("当前账号")}<select value={draft?.id || ''} onChange={event => select(event.target.value)}>{profiles.map(item => <option value={item.id} key={item.id}>{providerLabels[item.provider]} · {t(item.label)}{item.provider === 'codex' && item.status.account?.email ? ` · ${item.status.account.email}` : ''}</option>)}</select></label>
    {draft && <div className="agent-profile-editor">
      <p className={draft.status.installed ? 'agent-ready' : 'agent-offline'}>{t(draft.status.detail)}</p>
      {draft.provider === 'codex' && <div className="agent-login-identity"><strong>{t("Codex CLI 当前登录账号")}</strong>{draft.status.account ? <><span>{draft.status.account.name || draft.status.account.email}</span>{draft.status.account.name && draft.status.account.email && <small>{draft.status.account.email}</small>}</> : <span>{draft.status.authenticated ? t("已登录，但本机凭据未提供可识别的账号名称或邮箱") : t("未登录")}</span>}<small>{t("登录身份由 Codex CLI 管理，刷新状态后更新。")}</small></div>}
      <label>{t("账号备注名称")}<input value={draft.label} onChange={event => change({ label: event.target.value })}/></label>
      <label>{t("模型 ID")}<input value={draft.model} disabled={draft.provider === 'doubao'} onChange={event => change({ model: event.target.value })} placeholder={draft.provider === 'doubao' ? t("由豆包 CLI 管理") : t("留空使用 CLI 默认模型")}/></label>
      <label>{t("智能程度")}<select value={draft.effort} disabled={draft.provider === 'gemini' || draft.provider === 'doubao'} onChange={event => change({ effort: event.target.value as AgentProfile['effort'] })}><option value="auto">{t("自动")}</option><option value="low">{t("低")}</option><option value="medium">{t("中")}</option><option value="high">{t("高")}</option>{draft.provider === 'codex' && <option value="xhigh">{t("极高")}</option>}</select></label>
      <label className="settings-checkbox"><input type="checkbox" checked={draft.timeoutSeconds === 0} onChange={event => change({ timeoutSeconds: event.target.checked ? 0 : 600 })}/>{t("不限制单轮运行时间")}</label>
      {draft.timeoutSeconds > 0 && <label>{t("运行超时（秒）")}<input type="number" min={30} max={3600} value={draft.timeoutSeconds} onChange={event => change({ timeoutSeconds: Number(event.target.value) })}/></label>}
      <label className="settings-checkbox"><input type="checkbox" checked={draft.shareContext} onChange={event => change({ shareContext: event.target.checked })}/>{t("向此账号提供其他 Agent 的项目对话")}</label>
      {draft.shareContext && <label>{t("共享最近轮数")}<input type="number" min={0} max={30} value={draft.contextTurns} onChange={event => change({ contextTurns: Number(event.target.value) })}/></label>}
      {draft.provider === 'claude' && <><label>Anthropic API Key<input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={draft.keyConfigured ? t("已保存；留空保持不变") : t("填写此账号的密钥")}/></label>{draft.keyConfigured && <button onClick={() => void save(true)}>{t("清除已存密钥")}</button>}</>}
      <div className="agent-settings-actions"><button disabled={busy} onClick={() => void save()}>{t("保存设置")}</button>{draft.provider !== 'claude' && <button disabled={!draft.status.installed} onClick={() => void login()}>{t("打开登录终端")}</button>}<button onClick={() => void reload(draft.id)}>{t("刷新状态")}</button></div>
      <small>{draft.isolated ? t("此账号使用独立的本机配置目录。") : t("此账号使用系统已有的 CLI 登录。")}{draft.provider === 'doubao' ? t("豆包 CLI 目前仅支持系统默认账号，模型由其自身配置。") : ''}</small>
    </div>}
    <div className="agent-add-profile"><strong>{t("添加账号")}</strong><select value={newProvider} onChange={event => setNewProvider(event.target.value as AgentProviderId)}><option value="codex">Codex CLI</option><option value="gemini">Gemini CLI</option><option value="claude">Claude Code</option></select><input value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder={t("账号名称")}/><button disabled={busy || !newLabel.trim()} onClick={() => void add()}>{t("添加独立账号")}</button></div>
    {feedback && <p className="agent-settings-feedback" role="status">{feedback}</p>}
  </div>
}
