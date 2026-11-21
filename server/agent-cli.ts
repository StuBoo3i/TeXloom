import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type AgentProviderId = 'codex' | 'claude' | 'gemini' | 'doubao'
export type AgentMode = 'review' | 'edit'
export type AgentChange = { path: string; beforeHash: string; before: string; after: string }
export type AgentEvent = { type: 'thread' | 'text' | 'tool' | 'error' | 'done'; text?: string; threadId?: string }
export type AgentRunOptions = { cwd: string; prompt: string; threadId?: string; mode: AgentMode; env: NodeJS.ProcessEnv; model: string; effort: string; timeoutSeconds: number; signal?: AbortSignal; onEvent: (event: AgentEvent) => void }

export interface CliAgentProvider {
  id: AgentProviderId
  label: string
  status(env: NodeJS.ProcessEnv, keyConfigured?: boolean): Promise<{ installed: boolean; authenticated: boolean; detail: string }>
  login(env: NodeJS.ProcessEnv): void
  run(options: AgentRunOptions): Promise<{ threadId?: string; text: string; code: number }>
}

function spawnCli(command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
  // npm 在 Windows 安装的命令是 .cmd；spawn(..., shell:false) 无法直接启动它。
  if (process.platform === 'win32' && command !== 'codex') return spawn('cmd.exe', ['/d', '/s', '/c', command, ...args], { ...options, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  return spawn(command, args, { ...options, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
}

function runFixed(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 10000): Promise<{ code: number; output: string }> {
  return new Promise(resolve => {
    const child = spawnCli(command, args, { windowsHide: true, env })
    child.stdin.end()
    let output = ''
    child.stdout.on('data', chunk => { output = (output + chunk.toString('utf8')).slice(-2000) })
    child.stderr.on('data', chunk => { output = (output + chunk.toString('utf8')).slice(-2000) })
    const timer = setTimeout(() => child.kill(), timeout)
    child.once('error', error => { clearTimeout(timer); resolve({ code: -1, output: error.message }) })
    child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, output: output.trim() }) })
  })
}

export function codexEvent(value: unknown): AgentEvent | null {
  if (!value || typeof value !== 'object') return null
  const item = value as { type?: string; thread_id?: string; item?: { type?: string; text?: string; command?: string; output?: string }; message?: string; error?: { message?: string } }
  if (item.type === 'thread.started' && item.thread_id) return { type: 'thread', threadId: item.thread_id }
  if (item.type === 'item.completed' && item.item?.type === 'agent_message' && item.item.text) return { type: 'text', text: item.item.text }
  if (item.type === 'item.started' && item.item?.type === 'command_execution' && item.item.command) return { type: 'tool', text: item.item.command }
  if (item.type === 'turn.failed' || item.type === 'error') return { type: 'error', text: item.error?.message || item.message || 'Codex 运行失败' }
  if (item.type === 'turn.completed') return { type: 'done' }
  return null
}

export const codexProvider: CliAgentProvider = {
  id: 'codex', label: 'Codex CLI',
  async status(env) {
    const version = await runFixed('codex', ['--version'], env)
    if (version.code !== 0) return { installed: false, authenticated: false, detail: '未找到 codex 命令，请先安装 Codex CLI' }
    const login = await runFixed('codex', ['login', 'status'], env)
    return { installed: true, authenticated: login.code === 0, detail: login.code === 0 ? login.output : '尚未登录 Codex CLI' }
  },
  login(env) {
    if (process.platform !== 'win32') throw new Error('系统终端登录当前仅支持 Windows')
    const child = spawn('powershell.exe', ['-NoExit', '-NoProfile', '-Command', 'codex login'], { shell: false, detached: true, windowsHide: false, stdio: 'ignore', env })
    child.unref()
  },
  run({ cwd, prompt, threadId, mode, env, model, effort, timeoutSeconds, signal, onEvent }) {
    return new Promise((resolve, reject) => {
      const config = ['-c', 'approval_policy="never"', '--ignore-user-config', '--skip-git-repo-check', '--json']
      if (model) config.push('--model', model)
      if (effort !== 'auto') config.push('-c', `model_reasoning_effort="${effort}"`)
      const sandbox = mode === 'edit' ? 'workspace-write' : 'read-only'
      const args = threadId
        ? ['exec', 'resume', ...config, '-c', `sandbox_mode="${sandbox}"`, threadId, '-']
        : ['exec', ...config, '--sandbox', sandbox, '-C', cwd, '-']
      const child: ChildProcessWithoutNullStreams = spawn('codex', args, { cwd, shell: false, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] })
      let buffer = ''; let stderr = ''; let answer = ''; let currentThread = threadId; let settled = false
      const finishError = (error: Error) => { if (!settled) { settled = true; reject(error) } }
      const timer = setTimeout(() => child.kill(), timeoutSeconds * 1000)
      signal?.addEventListener('abort', () => child.kill(), { once: true })
      child.stdin.end(prompt)
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = codexEvent(JSON.parse(line))
            if (!event) continue
            if (event.type === 'thread') currentThread = event.threadId
            if (event.type === 'text') answer = event.text ?? ''
            onEvent(event)
          } catch { /* ignore non-JSON diagnostics */ }
        }
      })
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000) })
      child.once('error', error => { clearTimeout(timer); finishError(error) })
      child.once('close', code => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        resolve({ code: code ?? -1, text: answer.trim() || stderr.trim(), threadId: currentThread })
      })
    })
  },
}

function runStructured(command: string, args: string[], { cwd, prompt, threadId, env, timeoutSeconds, signal, onEvent }: AgentRunOptions, parse: (item: Record<string, unknown>) => AgentEvent | null): Promise<{ threadId?: string; text: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(command, args, { cwd, windowsHide: true, env })
    let buffer = ''; let stderr = ''; let answer = ''; let currentThread = threadId; let settled = false
    const timer = setTimeout(() => child.kill(), timeoutSeconds * 1000)
    signal?.addEventListener('abort', () => child.kill(), { once: true })
    child.stdin.end(prompt)
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const item = JSON.parse(line) as Record<string, unknown>
          if (typeof item.session_id === 'string') currentThread = item.session_id
          const event = parse(item)
          if (!event) continue
          if (event.type === 'thread') currentThread = event.threadId
          if (event.type === 'text' && event.text) answer = event.text
          onEvent(event)
        } catch { /* ignore diagnostics outside JSON events */ }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-3000) })
    child.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error) } })
    child.once('close', code => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (buffer.trim()) try { const item = JSON.parse(buffer) as Record<string, unknown>; if (typeof item.session_id === 'string') currentThread = item.session_id; const event = parse(item); if (event?.type === 'text' && event.text) answer = event.text; if (event?.type === 'thread') currentThread = event.threadId } catch { /* ignore */ }
      resolve({ code: code ?? -1, text: answer.trim() || stderr.trim(), threadId: currentThread })
    })
  })
}

export function claudeEvent(item: Record<string, unknown>): AgentEvent | null {
  if (item.type === 'result' && typeof item.result === 'string') return { type: 'text', text: item.result }
  if (typeof item.session_id === 'string' && item.type === 'system') return { type: 'thread', threadId: item.session_id }
  if (item.type === 'assistant' && item.message && typeof item.message === 'object') {
    const content = (item.message as { content?: { type?: string; text?: string }[] }).content
    const text = content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('')
    if (text) return { type: 'text', text }
  }
  if (item.type === 'error') return { type: 'error', text: String(item.message ?? 'Claude Code 运行失败') }
  return null
}

export function geminiEvent(item: Record<string, unknown>): AgentEvent | null {
  if (item.type === 'init' && typeof item.session_id === 'string') return { type: 'thread', threadId: item.session_id }
  if (item.type === 'message' && item.role === 'assistant' && typeof item.content === 'string') return { type: 'text', text: item.content }
  if (item.type === 'result' && typeof item.response === 'string') return { type: 'text', text: item.response }
  if (item.type === 'error') return { type: 'error', text: String(item.message ?? 'Gemini CLI 运行失败') }
  return null
}

export const claudeProvider: CliAgentProvider = {
  id: 'claude', label: 'Claude Code',
  async status(env, keyConfigured) {
    const version = await runFixed('claude', ['--version'], env)
    if (version.code !== 0) return { installed: false, authenticated: false, detail: '未找到 Claude Code CLI' }
    return { installed: true, authenticated: Boolean(keyConfigured), detail: keyConfigured ? '已配置此账号的 API Key' : '请在 Agent CLI 设置中配置 Anthropic API Key' }
  },
  login() { throw new Error('Claude Code 在 TeXloom 中使用独立 API Key，请在 Agent CLI 设置中填写') },
  run(options) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan']
    if (options.threadId) args.push('--resume', options.threadId)
    if (options.model) args.push('--model', options.model)
    if (options.effort !== 'auto') args.push('--effort', options.effort)
    return runStructured('claude', args, options, claudeEvent)
  },
}

export const geminiProvider: CliAgentProvider = {
  id: 'gemini', label: 'Gemini CLI',
  async status(env) {
    const version = await runFixed('gemini', ['--version'], env)
    return version.code === 0 ? { installed: true, authenticated: true, detail: '已找到 Gemini CLI；登录状态将在运行时确认' } : { installed: false, authenticated: false, detail: '未找到 Gemini CLI' }
  },
  login(env) {
    if (process.platform !== 'win32') throw new Error('系统终端登录当前仅支持 Windows')
    const child = spawn('powershell.exe', ['-NoExit', '-NoProfile', '-Command', 'gemini'], { shell: false, detached: true, windowsHide: false, stdio: 'ignore', env })
    child.unref()
  },
  run(options) {
    const args = ['--prompt', '请按标准输入中的任务说明处理。', '--output-format', 'stream-json', '--approval-mode', 'plan']
    if (options.threadId) args.push('--resume', options.threadId)
    if (options.model) args.push('--model', options.model)
    return runStructured('gemini', args, options, geminiEvent)
  },
}

export const doubaoProvider: CliAgentProvider = {
  id: 'doubao', label: '豆包 CLI',
  async status(env) {
    const version = await runFixed('doubao', ['--version'], env)
    return version.code === 0 ? { installed: true, authenticated: true, detail: '已找到豆包 CLI；登录状态将在运行时确认' } : { installed: false, authenticated: false, detail: '未找到 doubao 命令；TeXloom 不会自动安装' }
  },
  login(env) {
    if (process.platform !== 'win32') throw new Error('系统终端登录当前仅支持 Windows')
    const child = spawn('powershell.exe', ['-NoExit', '-NoProfile', '-Command', 'doubao login'], { shell: false, detached: true, windowsHide: false, stdio: 'ignore', env })
    child.unref()
  },
  async run(options) {
    const requestFile = path.join(options.cwd, '.texloom-agent-request.txt')
    await writeFile(requestFile, options.prompt, 'utf8')
    try {
      return await new Promise((resolve, reject) => {
        const child = spawnCli('doubao', ['-p', '请读取当前目录的 .texloom-agent-request.txt，并按其中的用户要求完成任务。'], { cwd: options.cwd, windowsHide: true, env: options.env })
        child.stdin.end()
        let stdout = ''; let stderr = ''; let settled = false
        const timer = setTimeout(() => child.kill(), options.timeoutSeconds * 1000)
        options.signal?.addEventListener('abort', () => child.kill(), { once: true })
        child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-100000) })
        child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-3000) })
        child.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error) } })
        child.once('close', code => { clearTimeout(timer); if (!settled) { settled = true; const answer = stdout.trim() || stderr.trim(); if (answer) options.onEvent({ type: 'text', text: answer }); resolve({ code: code ?? -1, text: answer }) } })
      })
    } finally { await rm(requestFile, { force: true }) }
  },
}

export const agentProviders: Record<AgentProviderId, CliAgentProvider> = { codex: codexProvider, claude: claudeProvider, gemini: geminiProvider, doubao: doubaoProvider }
