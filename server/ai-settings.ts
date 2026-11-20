import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type AiSettings = { model: string; maxOutputTokens: number; timeoutSeconds: number; encryptedKey?: string }
const defaults: AiSettings = { model: 'deepseek-flash', maxOutputTokens: 2048, timeoutSeconds: 90 }

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
  try { return { ...defaults, ...JSON.parse(await readFile(path.join(root, 'data', 'ai-settings.json'), 'utf8')) as AiSettings } }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults }; throw error }
}

export async function saveAiSettings(root: string, settings: AiSettings): Promise<void> {
  const directory = path.join(root, 'data')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'ai-settings.json')
  await writeFile(`${file}.tmp`, JSON.stringify(settings, null, 2), 'utf8')
  await rename(`${file}.tmp`, file)
}
