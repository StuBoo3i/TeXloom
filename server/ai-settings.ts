import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const aiProviders = {
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', protocol: 'openai' },
  volcano: { label: '火山引擎', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: '', protocol: 'openai' },
  aliyun: { label: '阿里云百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', protocol: 'openai' },
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini', protocol: 'openai' },
  anthropic: { label: 'Claude', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-5', protocol: 'anthropic' },
} as const
export type AiProviderId = keyof typeof aiProviders
export type AiProfile = { model: string; maxOutputTokens: number; timeoutSeconds: number; encryptedKey?: string }
export type AiSettings = { provider: AiProviderId; profiles: Record<AiProviderId, AiProfile> }
function defaultProfile(id: AiProviderId): AiProfile { return { model: aiProviders[id].model, maxOutputTokens: 2048, timeoutSeconds: 90 } }
export function defaultAiSettings(): AiSettings { return { provider: 'deepseek', profiles: Object.fromEntries(Object.keys(aiProviders).map(id => [id, defaultProfile(id as AiProviderId)])) as Record<AiProviderId, AiProfile> } }
export function aiSettingsView(settings: AiSettings) {
  const profile = settings.profiles[settings.provider]
  return { provider: settings.provider, configured: Boolean(profile.encryptedKey), model: profile.model, maxOutputTokens: profile.maxOutputTokens, timeoutSeconds: profile.timeoutSeconds, profiles: Object.fromEntries(Object.entries(settings.profiles).map(([id, value]) => [id, { configured: Boolean(value.encryptedKey), model: value.model, maxOutputTokens: value.maxOutputTokens, timeoutSeconds: value.timeoutSeconds }])) }
}

async function powershell(script: string, input: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('当前密钥存储仅支持 Windows')
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  let error = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString('utf8') })
  child.stdin.end(input)
  const code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? -1)) })
  if (code !== 0) throw new Error(`Windows 凭据加密失败：${error.trim().slice(0, 300)}`)
  return output.trim()
}

export async function protectKey(key: string): Promise<string> {
  return powershell('Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); $p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))', key)
}

export async function unprotectKey(encrypted: string): Promise<string> {
  return powershell('Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))', encrypted)
}

export async function readAiSettings(root: string): Promise<AiSettings> {
  const settings = defaultAiSettings()
  try {
    const stored = JSON.parse(await readFile(path.join(root, 'data', 'ai-settings.json'), 'utf8')) as Partial<AiSettings> & Partial<AiProfile>
    if (stored.profiles && stored.provider && Object.hasOwn(aiProviders, stored.provider)) {
      for (const id of Object.keys(aiProviders) as AiProviderId[]) settings.profiles[id] = { ...settings.profiles[id], ...(stored.profiles[id] ?? {}) }
      settings.provider = stored.provider
    } else settings.profiles.deepseek = { ...settings.profiles.deepseek, model: stored.model ?? 'deepseek-flash', maxOutputTokens: stored.maxOutputTokens ?? 2048, timeoutSeconds: stored.timeoutSeconds ?? 90, encryptedKey: stored.encryptedKey }
    return settings
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return settings; throw error }
}

export async function saveAiSettings(root: string, settings: AiSettings): Promise<void> {
  const directory = path.join(root, 'data')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'ai-settings.json')
  await writeFile(`${file}.tmp`, JSON.stringify(settings, null, 2), 'utf8')
  await rename(`${file}.tmp`, file)
}
