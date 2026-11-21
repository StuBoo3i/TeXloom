import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentChange } from './agent-cli.js'
import { applyLineHunks, lineHunks } from '../shared/agent-hunks.js'

const maxFiles = 1000
const maxBytes = 250 * 1024 * 1024
const maxPreviewBytes = 200 * 1024
const maxAllPreviews = 1024 * 1024

export function workspacePaths(container: string): { work: string; base: string } {
  return { work: path.join(container, 'work'), base: path.join(container, 'base') }
}

export function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function workspaceFile(root: string, relative: string): string {
  if (!relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Agent 文件路径无效')
  const target = path.resolve(root, ...relative.split('/'))
  if (path.relative(root, target).startsWith('..') || path.isAbsolute(path.relative(root, target))) throw new Error('Agent 文件路径越界')
  return target
}

async function draftGit(work: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['-C', work, ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } })
    let error = ''
    child.stderr.on('data', chunk => { error = (error + chunk.toString('utf8')).slice(-2000) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`无法建立 Agent 草稿的独立 Git 基线：${error.trim() || code}`)))
  })
}

export async function createAgentWorkspace(container: string, sourceRoot: string, entries: { path: string; size?: number }[]): Promise<string> {
  const total = entries.reduce((sum, item) => sum + (item.size ?? 0), 0)
  if (entries.length > maxFiles || total > maxBytes) throw new Error('项目超出 Agent 工作副本限制（1000 个文件或 250 MB）')
  const current = await lstat(container).catch(() => null)
  if (current?.isSymbolicLink()) throw new Error('Agent 工作目录不能是符号链接')
  await rm(container, { recursive: true, force: true })
  const { work, base } = workspacePaths(container)
  await mkdir(work, { recursive: true })
  await mkdir(base, { recursive: true })
  for (const entry of entries) {
    const source = workspaceFile(sourceRoot, entry.path)
    if (!(await lstat(source)).isFile()) throw new Error(`项目文件无法复制：${entry.path}`)
    const baseline = workspaceFile(base, entry.path)
    const draft = workspaceFile(work, entry.path)
    await mkdir(path.dirname(baseline), { recursive: true })
    await mkdir(path.dirname(draft), { recursive: true })
    await copyFile(source, baseline)
    await copyFile(baseline, draft)
  }
  await draftGit(work, ['init', '--quiet'])
  await draftGit(work, ['add', '--all', '--force'])
  await draftGit(work, ['-c', 'user.name=TeXloom', '-c', 'user.email=agent@texloom.local', 'commit', '--quiet', '--allow-empty', '-m', 'Agent draft baseline'])
  return work
}

export async function listWorkspaceFiles(root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  let total = 0
  async function visit(folder: string, prefix = ''): Promise<void> {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (!prefix && ['.git', '.openleaf', 'project.json'].includes(item.name)) continue
      if (item.isSymbolicLink()) throw new Error(`Agent 工作区包含符号链接：${prefix}${item.name}`)
      const relative = prefix ? `${prefix}/${item.name}` : item.name
      const target = workspaceFile(root, relative)
      if (item.isDirectory()) await visit(target, relative)
      else if (item.isFile()) {
        const info = await stat(target)
        total += info.size
        if (found.size >= maxFiles || total > maxBytes) throw new Error('Agent 工作区超出差异检查限制（1000 个文件或 250 MB）')
        found.set(relative, target)
      }
    }
  }
  await visit(root)
  return found
}

function previewText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return undefined }
}

export async function collectAgentChanges(base: string, work: string): Promise<AgentChange[]> {
  const [beforeFiles, afterFiles] = await Promise.all([listWorkspaceFiles(base), listWorkspaceFiles(work)])
  const paths = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort()
  const changes: AgentChange[] = []
  let previewBudget = maxAllPreviews
  for (const relative of paths) {
    const [beforeBytes, afterBytes] = await Promise.all([
      beforeFiles.has(relative) ? readFile(beforeFiles.get(relative)!) : Promise.resolve(undefined),
      afterFiles.has(relative) ? readFile(afterFiles.get(relative)!) : Promise.resolve(undefined),
    ])
    if (beforeBytes && afterBytes && beforeBytes.equals(afterBytes)) continue
    const beforeText = beforeBytes ? previewText(beforeBytes) : ''
    const afterText = afterBytes ? previewText(afterBytes) : ''
    const binary = beforeText === undefined || afterText === undefined
    const previewSize = (beforeBytes?.length ?? 0) + (afterBytes?.length ?? 0)
    const includePreview = !binary && previewSize <= maxPreviewBytes && previewSize <= previewBudget
    if (includePreview) previewBudget -= previewSize
    changes.push({
      path: relative,
      kind: !beforeBytes ? 'created' : !afterBytes ? 'deleted' : 'modified',
      ...(beforeBytes ? { beforeHash: hashBytes(beforeBytes) } : {}),
      ...(afterBytes ? { afterHash: hashBytes(afterBytes) } : {}),
      beforeSize: beforeBytes?.length ?? 0,
      afterSize: afterBytes?.length ?? 0,
      binary,
      ...(includePreview ? { before: beforeText, after: afterText } : {}),
    })
  }
  return changes
}

export async function readWorkspaceFile(file: string): Promise<Buffer | undefined> {
  const info = await lstat(file).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (!info) return undefined
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Agent 文件不是普通文件')
  return readFile(file)
}

async function writeAtomic(file: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.agent-${randomUUID()}.tmp`
  try { await writeFile(temporary, bytes); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }).catch(() => {}) }
}

export async function applyAgentChanges(
  changes: AgentChange[], base: string, work: string,
  projectFile: (relative: string) => Promise<string>,
  beforeApply: () => Promise<void> = async () => {},
  hunkSelections: Record<string, number[]> = {},
): Promise<string[]> {
  await Promise.all([listWorkspaceFiles(base), listWorkspaceFiles(work)])
  const prepared: { change: AgentChange; target: string; baseFile: string; before?: Buffer; after?: Buffer }[] = []
  const conflicts: string[] = []
  for (const change of changes) {
    const target = await projectFile(change.path)
    const baseFile = workspaceFile(base, change.path)
    const afterFile = workspaceFile(work, change.path)
    const [before, current, after] = await Promise.all([readWorkspaceFile(baseFile), readWorkspaceFile(target), readWorkspaceFile(afterFile)])
    if ((before ? hashBytes(before) : undefined) !== change.beforeHash ||
        (after ? hashBytes(after) : undefined) !== change.afterHash) throw new Error(`${change.path} 的草稿已变化，请刷新差异后重试`)
    if ((current ? hashBytes(current) : undefined) !== change.beforeHash) conflicts.push(change.path)
    let chosenAfter = after
    if (Object.hasOwn(hunkSelections, change.path)) {
      if (!before || !after || change.kind !== 'modified' || before.includes(0) || after.includes(0)) throw new Error(`${change.path} 不支持按段采纳`)
      const hunks = lineHunks(new TextDecoder('utf-8', { fatal: true }).decode(before), new TextDecoder('utf-8', { fatal: true }).decode(after))
      const selected = hunkSelections[change.path]
      if (!hunks || !Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(index => !Number.isInteger(index) || index < 0 || index >= hunks.length)) throw new Error(`${change.path} 的采纳片段无效`)
      chosenAfter = Buffer.from(applyLineHunks(before.toString('utf8'), hunks, new Set(selected)), 'utf8')
    }
    prepared.push({ change, target, baseFile, before, after: chosenAfter })
  }
  if (conflicts.length) throw Object.assign(new Error(`原项目已变化，需先核对冲突：${conflicts.join('、')}`), { statusCode: 409, conflicts })
  await beforeApply()
  const changedDuringSnapshot: string[] = []
  for (const item of prepared) {
    const current = await readWorkspaceFile(item.target)
    if ((current ? hashBytes(current) : undefined) !== item.change.beforeHash) changedDuringSnapshot.push(item.change.path)
  }
  if (changedDuringSnapshot.length) throw Object.assign(new Error(`原项目已变化，需先核对冲突：${changedDuringSnapshot.join('、')}`), { statusCode: 409, conflicts: changedDuringSnapshot })
  const written: typeof prepared = []
  try {
    for (const item of prepared) {
      if (item.after) await writeAtomic(item.target, item.after)
      else await rm(item.target, { force: true })
      written.push(item)
    }
    for (const item of prepared) {
      if (item.after) await writeAtomic(item.baseFile, item.after)
      else await rm(item.baseFile, { force: true })
    }
  } catch (error) {
    for (const item of [...prepared].reverse()) {
      if (item.before) await writeAtomic(item.baseFile, item.before)
      else await rm(item.baseFile, { force: true })
    }
    for (const item of written.reverse()) {
      if (item.before) await writeAtomic(item.target, item.before)
      else await rm(item.target, { force: true })
    }
    throw error
  }
  return changes.map(change => change.path)
}
