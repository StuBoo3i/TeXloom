import { aiProviders, type AiProviderId, type AiProfile } from './ai-settings.js'

export type AiMessage = { role: 'system' | 'user'; content: string | { type: 'text'; text: string }[] | { type: 'text'; text: string; imageDataUrl: string } }

export function providerRequest(provider: AiProviderId, profile: AiProfile, key: string, messages: AiMessage[], stream: boolean, signal: AbortSignal): { url: string; init: RequestInit } {
  const definition = aiProviders[provider]
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: object
  if (definition.protocol === 'anthropic') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
    const user = messages.filter(message => message.role === 'user').map(message => {
      if (typeof message.content === 'object' && 'imageDataUrl' in message.content) {
        const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(message.content.imageDataUrl)
        if (!match) throw new Error('Claude 图片格式无效')
        return { role: 'user', content: [{ type: 'text', text: message.content.text }, { type: 'image', source: { type: 'base64', media_type: `image/${match[1]}`, data: match[2] } }] }
      }
      return { role: 'user', content: message.content }
    })
    body = { model: profile.model, system, messages: user, max_tokens: profile.maxOutputTokens, stream }
  } else {
    headers.Authorization = `Bearer ${key}`
    const converted = messages.map(message => {
      if (typeof message.content === 'object' && 'imageDataUrl' in message.content) return { role: message.role, content: [{ type: 'text', text: message.content.text }, { type: 'image_url', image_url: { url: message.content.imageDataUrl } }] }
      return message
    })
    body = { model: profile.model, messages: converted, stream, [provider === 'openai' || provider === 'volcano' ? 'max_completion_tokens' : 'max_tokens']: profile.maxOutputTokens }
  }
  return { url: definition.endpoint, init: { method: 'POST', headers, body: JSON.stringify(body), signal } }
}

export function providerText(provider: AiProviderId, result: unknown): { text: string; truncated: boolean } {
  if (!result || typeof result !== 'object') return { text: '', truncated: false }
  if (provider === 'anthropic') {
    const value = result as { content?: { type?: string; text?: string }[]; stop_reason?: string }
    return { text: value.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('') ?? '', truncated: value.stop_reason === 'max_tokens' }
  }
  const value = result as { choices?: { finish_reason?: string; message?: { content?: string } }[] }
  return { text: value.choices?.[0]?.message?.content ?? '', truncated: value.choices?.[0]?.finish_reason === 'length' }
}

export function anthropicDelta(event: string): string | null {
  const data = event.split(/\r?\n/).find(line => line.startsWith('data:'))?.slice(5).trim()
  if (!data) return null
  const value = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } }
  if (value.type === 'error') throw new Error(value.error?.message || 'Claude 请求失败')
  return value.type === 'content_block_delta' && value.delta?.type === 'text_delta' ? value.delta.text ?? '' : null
}
