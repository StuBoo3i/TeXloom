import type { AgentChange, AgentProviderId } from './agent-cli.js'

export type AgentMessage = { id: number; role: 'user' | 'assistant' | 'system'; text: string; at: string; provider: AgentProviderId; profileId: string; model?: string; status?: 'partial' }
export type AgentLane = { provider: AgentProviderId; profileId: string; threadId?: string; lastSeen: number }
export type AgentSession = { schemaVersion: 2; messages: AgentMessage[]; lanes: Record<string, AgentLane>; pending: AgentChange[]; pendingLane?: string; updatedAt: string }

export function laneKey(provider: AgentProviderId, profileId: string): string { return `${provider}:${profileId}` }

export function normalizeAgentSession(raw: unknown): AgentSession {
  const now = new Date().toISOString()
  if (!raw || typeof raw !== 'object') return { schemaVersion: 2, messages: [], lanes: {}, pending: [], updatedAt: now }
  const item = raw as Record<string, unknown>
  const original = Array.isArray(item.messages) ? item.messages : []
  const messages = original.filter(value => value && typeof value === 'object' && typeof value.text === 'string' && ['user', 'assistant', 'system'].includes(value.role)).map((value, index) => ({
    id: Number.isSafeInteger(value.id) && value.id > 0 ? value.id : index + 1, role: value.role as AgentMessage['role'], text: String(value.text), at: typeof value.at === 'string' ? value.at : now,
    provider: ['codex', 'claude', 'gemini', 'doubao'].includes(value.provider) ? value.provider as AgentProviderId : 'codex',
    profileId: typeof value.profileId === 'string' ? value.profileId : 'codex-default',
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(value.status === 'partial' ? { status: 'partial' as const } : {}),
  }))
  const lanes: Record<string, AgentLane> = {}
  if (item.schemaVersion === 2 && item.lanes && typeof item.lanes === 'object') {
    for (const [key, value] of Object.entries(item.lanes)) {
      if (!value || typeof value !== 'object') continue
      const lane = value as Record<string, unknown>
      if (!['codex', 'claude', 'gemini', 'doubao'].includes(String(lane.provider)) || typeof lane.profileId !== 'string') continue
      lanes[key] = { provider: lane.provider as AgentProviderId, profileId: lane.profileId, threadId: typeof lane.threadId === 'string' ? lane.threadId : undefined, lastSeen: Math.max(0, Math.min(messages.at(-1)?.id ?? 0, Number(lane.lastSeen) || 0)) }
    }
  } else if (typeof item.threadId === 'string') lanes[laneKey('codex', 'codex-default')] = { provider: 'codex', profileId: 'codex-default', threadId: item.threadId, lastSeen: messages.at(-1)?.id ?? 0 }
  return { schemaVersion: 2, messages, lanes, pending: Array.isArray(item.pending) ? item.pending as AgentChange[] : [], pendingLane: typeof item.pendingLane === 'string' ? item.pendingLane : undefined, updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now }
}

export function sharedAgentContext(session: AgentSession, key: string, maxTurns: number, includeOwn = false): string {
  const lane = session.lanes[key]
  const recent = session.messages.filter(message => includeOwn || (message.id > (lane?.lastSeen ?? 0) && laneKey(message.provider, message.profileId) !== key)).slice(-Math.max(0, maxTurns * 2))
  if (!recent.length) return ''
  let budget = 12000
  const lines: string[] = []
  for (const message of [...recent].reverse()) {
    const line = `[${message.provider}/${message.profileId} · ${message.role}${message.status === 'partial' ? ' · 未完成' : ''}] ${message.text.slice(0, 3000)}`
    if (line.length > budget) break
    budget -= line.length
    lines.unshift(line)
  }
  return lines.join('\n')
}

export function appendAgentMessage(session: AgentSession, message: Omit<AgentMessage, 'id'>): void {
  session.messages.push({ ...message, id: (session.messages.at(-1)?.id ?? 0) + 1 })
  session.messages = session.messages.slice(-120)
}
