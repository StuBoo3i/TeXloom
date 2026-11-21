import assert from 'node:assert/strict'
import { readAiSettings } from '../server/ai-settings'

const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const initial = await readAiSettings(root)
if (initial.profiles.deepseek.encryptedKey) throw new Error('已有 DeepSeek API Key，跳过测试以避免覆盖用户设置')
process.env.PORT = '3003'
const originalFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input) === 'https://api.deepseek.com/chat/completions') {
    assert.equal(init?.method, 'POST')
    const request = JSON.parse(String(init?.body)) as { messages: { content: unknown }[] }
    if (Array.isArray(request.messages[1].content)) assert.equal((request.messages[1].content as { type: string }[])[1].type, 'image_url')
    return Promise.resolve(new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":"，世界"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
  }
  return originalFetch(input, init)
}) as typeof fetch

const { app } = await import('../server/index')
const base = 'http://127.0.0.1:3003'
async function api(path: string, body?: unknown, method = 'GET') {
  const response = await originalFetch(`${base}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(await response.text())
  return response
}
try {
  await api('/api/ai/settings', { provider: 'deepseek', apiKey: 'mock-key', model: 'deepseek-flash', maxOutputTokens: 512, timeoutSeconds: 30 }, 'PUT')
  const response = await api('/api/ai/chat', { mode: 'chat', prompt: '打招呼', selectedText: '', context: '' }, 'POST')
  const stream = await response.text()
  assert.match(stream, /你好/)
  assert.match(stream, /，世界/)
  assert.match(stream, /\[DONE\]/)
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lXcAAAAASUVORK5CYII='
  const imageResponse = await api('/api/ai/chat', { mode: 'table', prompt: '转换表格', selectedText: '', context: '', imageDataUrl: png }, 'POST')
  assert.match(await imageResponse.text(), /你好/)
  console.log('AI streaming proxy smoke check passed')
} finally {
  await api('/api/ai/settings', { provider: 'deepseek', clearKey: true, model: initial.profiles.deepseek.model, maxOutputTokens: initial.profiles.deepseek.maxOutputTokens, timeoutSeconds: initial.profiles.deepseek.timeoutSeconds }, 'PUT')
  if (initial.provider !== 'deepseek') await api('/api/ai/settings', { provider: initial.provider, model: initial.profiles[initial.provider].model, maxOutputTokens: initial.profiles[initial.provider].maxOutputTokens, timeoutSeconds: initial.profiles[initial.provider].timeoutSeconds }, 'PUT')
  await app.close()
}
