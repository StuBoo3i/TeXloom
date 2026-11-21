export type AgentProviderId = 'codex' | 'claude' | 'gemini' | 'doubao'
export type AgentProfile = {
  id: string
  provider: AgentProviderId
  label: string
  isolated: boolean
  model: string
  effort: 'auto' | 'low' | 'medium' | 'high' | 'xhigh'
  timeoutSeconds: number
  contextTurns: number
  shareContext: boolean
  keyConfigured: boolean
  status: { installed: boolean; authenticated: boolean; detail: string }
}
export type AgentChange = { path: string; beforeHash: string; before: string; after: string }
export type AgentMessage = { id: number; role: 'user' | 'assistant' | 'system'; text: string; at: string; provider: AgentProviderId; profileId: string; model?: string }
export type AgentSession = { schemaVersion: 2; messages: AgentMessage[]; pending: AgentChange[]; pendingLane?: string; running: boolean }
export const providerLabels: Record<AgentProviderId, string> = { codex: 'Codex CLI', claude: 'Claude Code', gemini: 'Gemini CLI', doubao: '豆包 CLI' }

export async function agentApi<T>(url: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(url, { method, headers: { 'X-TeXloom-Agent': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(detail.message || detail.error || `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
}
