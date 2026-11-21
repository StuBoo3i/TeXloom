import { useEffect, useState } from 'react'

export const providerOptions = [
  { id: 'deepseek', label: 'DeepSeek', endpoint: 'api.deepseek.com' },
  { id: 'volcano', label: '火山引擎 Ark', endpoint: 'ark.cn-beijing.volces.com' },
  { id: 'aliyun', label: '阿里云百炼', endpoint: 'dashscope.aliyuncs.com' },
  { id: 'openai', label: 'OpenAI GPT', endpoint: 'api.openai.com' },
  { id: 'anthropic', label: 'Claude 原生 API', endpoint: 'api.anthropic.com' },
] as const
export type AiProviderId = typeof providerOptions[number]['id']
export type AiProfileView = { configured: boolean; model: string; maxOutputTokens: number; timeoutSeconds: number }
export type AiSettingsView = AiProfileView & { provider: AiProviderId; profiles: Record<AiProviderId, AiProfileView> }
export type AiSettingsInput = Omit<AiProfileView, 'configured'> & { provider: AiProviderId; apiKey?: string; clearKey?: boolean }

export function AiServiceSettings({ value, onSave }: { value: AiSettingsView; onSave: (settings: AiSettingsInput) => void }) {
  const [provider, setProvider] = useState<AiProviderId>(value.provider)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(value.model)
  const [maxOutputTokens, setMaxOutputTokens] = useState(value.maxOutputTokens)
  const [timeoutSeconds, setTimeoutSeconds] = useState(value.timeoutSeconds)
  useEffect(() => { setProvider(value.provider); setModel(value.model); setMaxOutputTokens(value.maxOutputTokens); setTimeoutSeconds(value.timeoutSeconds) }, [value])
  const selected = providerOptions.find(item => item.id === provider)!
  const profile = value.profiles[provider]
  function select(next: AiProviderId) {
    setProvider(next); setApiKey('')
    const item = value.profiles[next]
    setModel(item.model); setMaxOutputTokens(item.maxOutputTokens); setTimeoutSeconds(item.timeoutSeconds)
  }
  const input = { provider, model, maxOutputTokens, timeoutSeconds }
  return <section className="ai-service-settings">
    <strong>AI API 服务</strong>
    <label>服务商<select value={provider} onChange={event => select(event.target.value as AiProviderId)}>{providerOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <p>{profile.configured ? '此服务商已配置 API Key' : '此服务商尚未配置 API Key'} · {selected.endpoint}</p>
    <label>API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={profile.configured ? '留空则保留已有密钥' : '输入 API Key'} /></label>
    <label>模型 ID<input value={model} onChange={event => setModel(event.target.value)} placeholder={provider === 'volcano' ? '输入模型 ID 或推理接入点 ID' : '输入模型 ID'} /></label>
    <label>单次最大输出 Token<input type="number" min="256" max="8192" value={maxOutputTokens} onChange={event => setMaxOutputTokens(Number(event.target.value))} /></label>
    <label>请求超时（秒）<input type="number" min="10" max="180" value={timeoutSeconds} onChange={event => setTimeoutSeconds(Number(event.target.value))} /></label>
    <p>密钥使用当前 Windows 用户加密保存。仅主动使用写作助手、图片识别或宏包分析时，将所选内容发送给当前服务商。切换服务商不会删除其他服务商的密钥。</p>
    <button className="panel-action" onClick={() => { onSave({ ...input, apiKey }); setApiKey('') }}>保存并启用此服务</button>
    {profile.configured && <button className="panel-action" onClick={() => onSave({ ...input, clearKey: true })}>移除此服务的 API Key</button>}
  </section>
}
