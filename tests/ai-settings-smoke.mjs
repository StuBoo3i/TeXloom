import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.TEXLOOM_URL || process.env.OPENLEAF_URL || 'http://127.0.0.1:3002'
async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || String(response.status))
  return data
}

const initial = await api('GET', '/api/ai/settings')
if (initial.configured) throw new Error('已有 API Key，跳过测试以避免覆盖用户设置')
const sampleKey = `texloom-test-${Date.now()}`
try {
  const updated = await api('PUT', '/api/ai/settings', { apiKey: sampleKey, model: 'deepseek-flash', maxOutputTokens: 512, timeoutSeconds: 30 })
  assert.equal(updated.configured, true)
  assert.equal(updated.apiKey, undefined)
  assert.equal((await api('GET', '/api/ai/settings')).configured, true)
  const localFile = await readFile(new URL('../data/ai-settings.json', import.meta.url), 'utf8')
  assert.ok(!localFile.includes(sampleKey))
  console.log('AI settings encryption and redaction checks passed')
} finally {
  await api('PUT', '/api/ai/settings', { clearKey: true, model: initial.model, maxOutputTokens: initial.maxOutputTokens, timeoutSeconds: initial.timeoutSeconds })
}
