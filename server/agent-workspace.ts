import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentChange } from './agent-cli.js'
import { applyLineHunks, lineHunks } from '../shared/agent-hunks.js'
import type { AgentResolution } from '../shared/agent-review.js'

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

export function previewText(bytes: Buffer): string | undefined {
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
  resolutions: Record<string, AgentResolution> = {},
): Promise<string[]> {
  await Promise.all([listWorkspaceFiles(base), listWorkspaceFiles(work)])
  const updates: { file: string; before?: Buffer; after?: Buffer }[] = []
  const checked: { file: string; hash?: string; path: string }[] = []
  const unified: { path: string; files: string[]; hash?: string }[] = []
  const applied: string[] = []
  const conflicts: string[] = []
  for (const change of changes) {
    const target = await projectFile(change.path)
    const baseFile = workspaceFile(base, change.path)
    const afterFile = workspaceFile(work, change.path)
    const [before, current, after] = await Promise.all([readWorkspaceFile(baseFile), readWorkspaceFile(target), readWorkspaceFile(afterFile)])
    const beforeHash = before && hashBytes(before)
    const afterHash = after && hashBytes(after)
    const currentHash = current && hashBytes(current)
    const resolution = Object.hasOwn(resolutions, change.path) ? resolutions[change.path] : undefined
    if (beforeHash !== change.beforeHash || afterHash !== change.afterHash
      || (resolution && (resolution.beforeHash !== (beforeHash ?? null) || resolution.afterHash !== (afterHash ?? null) || resolution.currentHash !== (currentHash ?? null)))
      || (!resolution && currentHash !== beforeHash)) {
      conflicts.push(change.path)
      continue
    }
    checked.push({ file: target, hash: currentHash, path: change.path }, { file: baseFile, hash: beforeHash, path: change.path }, { file: afterFile, hash: afterHash, path: change.path })
    if (resolution) {
      const keep = resolution.choice === 'current'
      const winner = keep ? current : after
      const hash = keep ? currentHash : afterHash
      unified.push({ path: change.path, files: [target, baseFile, afterFile], hash })
      if (currentHash !== hash) updates.push({ file: target, before: current, after: winner })
      if (beforeHash !== hash) updates.push({ file: baseFile, before, after: winner })
      if (afterHash !== hash) updates.push({ file: afterFile, before: after, after: winner })
      if (!keep) applied.push(change.path)
      continue
    }
    let chosenAfter = after
    if (Object.hasOwn(hunkSelections, change.path)) {
      if (!before || !after || change.kind !== 'modified' || before.includes(0) || after.includes(0)) throw new Error(`${change.path} 不支持按段采纳`)
      const hunks = lineHunks(new TextDecoder('utf-8', { fatal: true }).decode(before), new TextDecoder('utf-8', { fatal: true }).decode(after))
      const selected = hunkSelections[change.path]
      if (!hunks || !Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(index => !Number.isInteger(index) || index < 0 || index >= hunks.length)) throw new Error(`${change.path} 的采纳片段无效`)
      chosenAfter = Buffer.from(applyLineHunks(before.toString('utf8'), hunks, new Set(selected)), 'utf8')
    }
    applied.push(change.path)
    updates.push({ file: target, before: current, after: chosenAfter }, { file: baseFile, before, after: chosenAfter })
  }
  if (conflicts.length) throw Object.assign(new Error(`原项目已变化，需先核对冲突：${conflicts.join('、')}`), { statusCode: 409, conflicts })
  if (applied.length) await beforeApply()
  const changedDuringSnapshot: string[] = []
  for (const { file, hash, path } of checked) {
    const bytes = await readWorkspaceFile(file)
    if ((bytes && hashBytes(bytes)) !== hash && !changedDuringSnapshot.includes(path)) changedDuringSnapshot.push(path)
  }
  if (changedDuringSnapshot.length) throw Object.assign(new Error(`原项目已变化，需先核对冲突：${changedDuringSnapshot.join('、')}`), { statusCode: 409, conflicts: changedDuringSnapshot })
  const written: typeof updates = []
  try {
    for (const item of updates) {
      if (item.after) await writeAtomic(item.file, item.after)
      else await rm(item.file, { force: true })
      written.push(item)
    }
    for (const { path, files, hash } of unified) {
      for (const file of files) {
        const bytes = await readWorkspaceFile(file)
        if ((bytes && hashBytes(bytes)) !== hash) {
          throw Object.assign(new Error(path + ' 在同步期间再次变化，请刷新差异后重试'), { statusCode: 409 })
        }
      }
    }
  } catch (error) {
    for (const item of written.reverse()) {
      const current = await readWorkspaceFile(item.file)
      // Keep any new write that happened after this batch updated the file.
      if (current ? !item.after || !current.equals(item.after) : item.after !== undefined) continue
      if (item.before) await writeAtomic(item.file, item.before)
      else await rm(item.file, { force: true })
    }
    throw error
  }
  return applied
}
