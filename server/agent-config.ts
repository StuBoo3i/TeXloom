import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentProviderId } from './agent-cli.js'

export type AgentEffort = 'auto' | 'low' | 'medium' | 'high' | 'xhigh'
export type AgentProfile = { id: string; provider: AgentProviderId; label: string; isolated: boolean; model: string; effort: AgentEffort; timeoutSeconds: number; contextTurns: number; shareContext: boolean; encryptedKey?: string }
export type AgentConfig = { version: 1; profiles: AgentProfile[] }
export type AgentProfileView = Omit<AgentProfile, 'encryptedKey'> & { keyConfigured: boolean }

export function defaultAgentConfig(): AgentConfig { return { version: 1, profiles: [
  { id: 'codex-default', provider: 'codex', label: '系统默认账号', isolated: false, model: '', effort: 'auto', timeoutSeconds: 180, contextTurns: 12, shareContext: true },
  { id: 'gemini-default', provider: 'gemini', label: '系统默认账号', isolated: false, model: '', effort: 'auto', timeoutSeconds: 180, contextTurns: 12, shareContext: true },
  { id: 'claude-default', provider: 'claude', label: 'API Key 账号', isolated: true, model: '', effort: 'auto', timeoutSeconds: 180, contextTurns: 12, shareContext: true },
  { id: 'doubao-default', provider: 'doubao', label: '系统默认账号', isolated: false, model: '', effort: 'auto', timeoutSeconds: 180, contextTurns: 12, shareContext: true },
] } }

export function agentProfileView(profile: AgentProfile): AgentProfileView {
  const { encryptedKey, ...visible } = profile
  return { ...visible, keyConfigured: Boolean(encryptedKey) }
}

export function newAgentProfile(provider: AgentProviderId, label: string): AgentProfile {
  return { id: randomUUID(), provider, label, isolated: true, model: '', effort: 'auto', timeoutSeconds: 180, contextTurns: 12, shareContext: true }
}

export async function readAgentConfig(root: string): Promise<AgentConfig> {
  const defaults = defaultAgentConfig()
  try {
    const saved = JSON.parse(await readFile(path.join(root, 'data', 'agent-profiles.json'), 'utf8')) as AgentConfig
    if (!Array.isArray(saved.profiles)) return defaults
    const profiles = saved.profiles.filter(item => item && typeof item.id === 'string' && /^(?:[a-f0-9-]{36}|(?:codex|claude|gemini|doubao)-default)$/.test(item.id) && ['codex', 'claude', 'gemini', 'doubao'].includes(item.provider)).map(item => ({ ...defaults.profiles.find(value => value.id === item.id), ...item }))
    for (const entry of defaults.profiles) if (!profiles.some(item => item.id === entry.id)) profiles.push(entry)
    return { version: 1, profiles }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults; throw error }
}

export async function writeAgentConfig(root: string, config: AgentConfig): Promise<void> {
  const directory = path.join(root, 'data')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'agent-profiles.json')
  await writeFile(`${file}.tmp`, JSON.stringify(config, null, 2), 'utf8')
  await rename(`${file}.tmp`, file)
}

export async function agentProfileEnvironment(root: string, profile: AgentProfile): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env }
  if (profile.isolated) {
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete env[key]
    const home = path.join(root, 'data', 'agent-accounts', profile.id)
    await mkdir(home, { recursive: true })
    if (profile.provider === 'codex') env.CODEX_HOME = home
    if (profile.provider === 'gemini') env.GEMINI_CLI_HOME = home
    if (profile.provider === 'claude') env.CLAUDE_CONFIG_DIR = home
  }
  return env
}
