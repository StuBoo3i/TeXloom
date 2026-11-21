import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export type CodexAccount = { name?: string; email?: string }

function displayText(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined
}

export async function readCodexAccount(env: NodeJS.ProcessEnv): Promise<CodexAccount | undefined> {
  try {
    const home = env.CODEX_HOME || path.join(homedir(), '.codex')
    const auth = JSON.parse(await readFile(path.join(home, 'auth.json'), 'utf8')) as { tokens?: { id_token?: unknown } }
    const token = auth.tokens?.id_token
    if (typeof token !== 'string') return undefined
    const payload = token.split('.')[1]
    if (!payload || payload.length > 64_000) return undefined
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { name?: unknown; email?: unknown }
    const name = displayText(claims.name, 120)
    const email = displayText(claims.email, 320)
    return name || email ? { ...(name ? { name } : {}), ...(email ? { email } : {}) } : undefined
  } catch { return undefined }
}
