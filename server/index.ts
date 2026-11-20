import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { protectKey, readAiSettings, saveAiSettings, unprotectKey } from './ai-settings.js'
import { parseSynctex } from './synctex.js'
import { githubRemote, safeBranch } from './git-collab.js'
import { foldReviewEvents, makeReviewEvent, readReviewEvents, writeReviewEvent, type ReviewEvent, type ReviewThread } from './review-events.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectsRoot = path.join(root, 'projects')
const tectonicPath = path.join(root, 'runtime', process.platform === 'win32' ? 'tectonic.exe' : 'tectonic')
const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 })

type Project = { id: string; name: string; mainFile: string; createdAt: string; updatedAt: string; sharing?: 'personal' | 'shared'; archived?: boolean; tags?: string[] }
type FileEntry = { path: string; type: 'file' | 'directory'; size?: number }
type Job = { id: string; projectId: string; status: 'running' | 'success' | 'error'; log: string; startedAt: string; finishedAt?: string }
type Snapshot = { id: string; note: string; createdAt: string; fileCount: number }
const jobs = new Map<string, Job>()
const activeProjects = new Set<string>()
const reviewLocks = new Map<string, Promise<void>>()
const folderSelections = new Map<string, { path: string; mode: 'import' | 'export'; expires: number }>()

async function withReviewLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = reviewLocks.get(id) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  reviewLocks.set(id, current)
  await previous
  try { return await action() }
  finally { release(); if (reviewLocks.get(id) === current) reviewLocks.delete(id) }
}

function fail(statusCode: number, message: string): never {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  throw error
}

function projectDir(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) fail(400, '无效的项目 ID')
  return path.join(projectsRoot, id)
}

function selectedFolder(token: unknown, mode: 'import' | 'export', consume = false): string {
  if (typeof token !== 'string') fail(400, '请先选择本地文件夹')
  const item = folderSelections.get(token)
  if (!item || item.mode !== mode || item.expires < Date.now()) fail(400, '文件夹选择已失效，请重新选择')
  if (consume) folderSelections.delete(token)
  return item.path
}

async function chooseWindowsFolder(mode: 'import' | 'export'): Promise<string | null> {
  if (process.platform !== 'win32') fail(501, '当前文件夹选择仅支持 Windows')
  const title = mode === 'import' ? '选择包含 LaTeX 项目的文件夹' : '选择批量导出的目标文件夹'
  const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${title}'; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }`
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let error = ''
  child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-4000) })
  child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString('utf8')).slice(-4000) })
  const timer = setTimeout(() => child.kill(), 300_000)
  try {
    const code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', value => resolve(value ?? -1)) })
    if (code !== 0) fail(422, `无法打开文件夹选择器：${error.trim().slice(0, 200)}`)
    return output.trim() ? await realpath(output.trim()) : null
  } finally { clearTimeout(timer) }
}

type FolderCandidate = { name: string; directory: string; files: { relative: string; absolute: string; size: number }[]; mainFile: string; bytes: number; metadata?: { name?: string; mainFile?: string; sharing?: 'personal' | 'shared'; archived?: boolean; tags?: string[] } }
const ignoredImportDirs = new Set(['.git', '.openleaf', '.texloom', 'node_modules', 'dist', 'data', 'runtime'])
const ignoredImportFiles = new Set(['project.json', '.texloom-project.json', '.env', 'id_rsa', 'id_ed25519'])

async function scanCandidate(directory: string, name: string): Promise<FolderCandidate | null> {
  const files: FolderCandidate['files'] = []
  let bytes = 0
  async function visit(current: string, prefix: string, depth: number): Promise<void> {
    if (depth > 10) fail(413, `项目“${name}”目录层级过深`)
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(current, entry.name)
      const details = await lstat(absolute)
      if (details.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (ignoredImportDirs.has(entry.name)) continue
        await visit(absolute, prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1)
      } else if (entry.isFile()) {
        if (ignoredImportFiles.has(entry.name) || entry.name.startsWith('.env.') || /\.(?:pem|key)$/i.test(entry.name)) continue
        const relative = safeRelative(prefix ? `${prefix}/${entry.name}` : entry.name)
        if (details.size > 20 * 1024 * 1024) fail(413, `项目“${name}”含有超过 20 MB 的文件`)
        bytes += details.size
        if (files.length >= 1000 || bytes > 100 * 1024 * 1024) fail(413, `项目“${name}”超过 1000 个文件或 100 MB`)
        files.push({ relative, absolute, size: details.size })
      }
    }
  }
  await visit(directory, '', 0)
  const tex = files.filter(file => file.relative.toLowerCase().endsWith('.tex'))
  if (!tex.length) return null
  const fallbackMain = tex.find(file => file.relative === 'main.tex')?.relative ?? tex.sort((a, b) => a.relative.split('/').length - b.relative.split('/').length || a.relative.localeCompare(b.relative))[0].relative
  let metadata: FolderCandidate['metadata']
  try {
    const manifest = path.join(directory, '.texloom-project.json')
    const info = await lstat(manifest)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) fail(413, '项目元数据文件无效或过大')
    const raw = JSON.parse(await readFile(manifest, 'utf8')) as FolderCandidate['metadata']
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) metadata = raw
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  const mainFile = typeof metadata?.mainFile === 'string' && tex.some(file => file.relative === metadata!.mainFile) ? metadata.mainFile : fallbackMain
  return { name: typeof metadata?.name === 'string' && metadata.name.trim() ? metadata.name.trim().slice(0, 80) : name.slice(0, 80), directory, files, mainFile, bytes, metadata }
}

async function folderCandidates(directory: string): Promise<FolderCandidate[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.tex'))) {
    const one = await scanCandidate(directory, path.basename(directory))
    return one ? [one] : []
  }
  const folders = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !ignoredImportDirs.has(entry.name))
  if (folders.length > 50) fail(413, '选中的目录包含过多子文件夹，请选择更具体的目录')
  const result: FolderCandidate[] = []
  for (const entry of folders) {
    const candidate = await scanCandidate(path.join(directory, entry.name), entry.name)
    if (candidate) result.push(candidate)
  }
  if (result.length > 30) fail(413, '一次最多导入 30 个项目')
  return result
}

function safeRelative(input: unknown): string {
  if (typeof input !== 'string' || !input || input.length > 300 || input.includes('\\') || input.includes(':') || input.startsWith('/')) fail(400, '无效的文件路径')
  const parts = input.split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || p === '.openleaf' || p === '.git' || p === 'project.json' || /[<>"|?*\x00-\x1f]/.test(p))) fail(400, '无效的文件路径')
  return parts.join('/')
}

function imageExtension(file: string): string {
  const extension = path.extname(file).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.pdf'].includes(extension)) fail(400, '图片仅支持 PNG、JPEG 或 PDF')
  return extension
}

function imageDestination(id: string, name: string): { relative: string; absolute: string } {
  imageExtension(name)
  const clean = path.basename(name).replace(/[^\p{L}\p{N}._-]/gu, '-').slice(-100)
  const relative = `images/${randomUUID().slice(0, 8)}-${clean}`
  return { relative, absolute: path.join(projectDir(id), relative) }
}

function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224)
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase()
    return !(value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('::ffff:'))
  }
  return false
}

async function safeFile(id: string, relative: string): Promise<string> {
  const base = projectDir(id)
  const parts = safeRelative(relative).split('/')
  let current = base
  for (const part of parts) {
    current = path.join(current, part)
    try {
      const item = await import('node:fs/promises').then(fs => fs.lstat(current))
      if (item.isSymbolicLink()) fail(400, '不允许使用符号链接')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return current
}

async function getProject(id: string): Promise<Project> {
  try { return JSON.parse(await readFile(path.join(projectDir(id), 'project.json'), 'utf8')) as Project }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail(404, '项目不存在')
    throw error
  }
}

function validTag(input: unknown): string {
  if (typeof input !== 'string') fail(400, '标签名称无效')
  const name = input.trim()
  if (!name || name.length > 30 || /[\x00-\x1f]/.test(name)) fail(400, '标签名称须为 1 至 30 个字符')
  return name
}

const tagsFile = path.join(root, 'data', 'project-tags.json')
async function readTags(): Promise<string[]> {
  try { const value = JSON.parse(await readFile(tagsFile, 'utf8')) as unknown; return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : [] }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
async function writeTags(tags: string[]): Promise<void> {
  await mkdir(path.dirname(tagsFile), { recursive: true })
  await writeFile(`${tagsFile}.tmp`, JSON.stringify([...new Set(tags)].sort((a, b) => a.localeCompare(b, 'zh-CN'))), 'utf8')
  await rename(`${tagsFile}.tmp`, tagsFile)
}

async function projectForList(project: Project): Promise<Project> {
  if (project.sharing) return project
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) return { ...project, sharing: 'personal' }
  const remote = await gitCommand(directory, ['remote', 'get-url', 'origin']).catch(() => '')
  try { githubRemote(remote) } catch { return { ...project, sharing: 'personal' } }
  const authors = await gitCommand(directory, ['shortlog', '-sne', '--all']).catch(() => '')
  return { ...project, sharing: authors.split(/\r?\n/).filter(Boolean).length > 1 ? 'shared' : 'personal' }
}

async function saveProject(project: Project): Promise<void> {
  project.updatedAt = new Date().toISOString()
  await writeFile(path.join(projectDir(project.id), 'project.json'), JSON.stringify(project, null, 2), 'utf8')
}

async function readReview(id: string): Promise<ReviewThread[]> {
  try { return JSON.parse(await readFile(path.join(projectDir(id), '.openleaf', 'review.json'), 'utf8')) as ReviewThread[] }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

async function writeReview(id: string, threads: ReviewThread[]): Promise<void> {
  const directory = path.join(projectDir(id), '.openleaf')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'review.json')
  await writeFile(`${file}.tmp`, JSON.stringify(threads, null, 2), 'utf8')
  await rename(`${file}.tmp`, file)
}

function reviewOutbox(id: string): string { return path.join(projectDir(id), '.openleaf', 'review-outbox') }
function reviewWorktree(id: string): string { return path.join(projectDir(id), '.openleaf', 'review-worktree') }

async function checkedReviewEventsDirectory(id: string): Promise<string> {
  let current = reviewWorktree(id)
  for (const part of ['.texloom', 'reviews', 'events']) {
    current = path.join(current, part)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink() || !entry.isDirectory()) fail(422, '审阅分支包含不安全的目录结构')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return current
}

async function reviewActor(id: string): Promise<string> {
  try { return (await readFile(path.join(projectDir(id), '.openleaf', 'author.txt'), 'utf8')).replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 100) || '本地用户' }
  catch { return '本地用户' }
}

async function ensureReviewMigration(id: string): Promise<void> {
  const marker = path.join(projectDir(id), '.openleaf', 'review-events-v1')
  if (existsSync(marker)) return
  await mkdir(path.dirname(marker), { recursive: true })
  const legacy = await readReview(id)
  for (const thread of legacy) {
    const event = makeReviewEvent('thread.created', thread.id, await reviewActor(id), { thread })
    await writeReviewEvent(reviewOutbox(id), event)
  }
  await writeFile(marker, '1', 'utf8')
}

async function reviewTarget(id: string, file: string): Promise<NonNullable<ReviewThread['target']>> {
  const directory = projectDir(id)
  const [branch, commit, blob] = await Promise.all([
    gitCommand(directory, ['symbolic-ref', '--short', 'HEAD']).catch(() => ''),
    gitCommand(directory, ['rev-parse', 'HEAD']).catch(() => ''),
    gitCommand(directory, ['hash-object', await safeFile(id, file)]).catch(() => ''),
  ])
  return { branch, commit, blob }
}

async function visibleReviews(id: string): Promise<(ReviewThread & { locationStale: boolean })[]> {
  const threads = await readReview(id)
  const blobs = new Map<string, string>()
  await Promise.all([...new Set(threads.map(item => item.file))].map(async file => {
    try { blobs.set(file, await gitCommand(projectDir(id), ['hash-object', await safeFile(id, file)])) }
    catch { blobs.set(file, '') }
  }))
  return threads.map(thread => ({ ...thread, locationStale: Boolean(thread.target?.blob && thread.target.blob !== blobs.get(thread.file)) }))
}

async function appendReviewEvent(id: string, event: ReviewEvent): Promise<void> {
  await ensureReviewMigration(id)
  await writeReviewEvent(reviewOutbox(id), event)
}

async function materializeReviewEvents(id: string): Promise<{ threads: number; pending: number }> {
  const shared = await readReviewEvents(await checkedReviewEventsDirectory(id))
  const pending = await readReviewEvents(reviewOutbox(id))
  const unique = new Map([...shared, ...pending].map(event => [event.id, event]))
  const threads = foldReviewEvents([...unique.values()])
  await writeReview(id, threads)
  return { threads: threads.length, pending: pending.length }
}

async function syncReviewEvents(id: string): Promise<{ threads: number; pending: number }> {
  await ensureReviewMigration(id)
  const directory = projectDir(id)
  await assertCollaborationRemote(directory)
  const outbox = reviewOutbox(id)
  const queued = await readReviewEvents(outbox)
  await gitCommand(directory, ['fetch', '--prune', 'origin'], 120000)
  const remoteBranch = await gitCommand(directory, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/texloom-reviews']).then(() => true).catch(() => false)
  if (!remoteBranch && !queued.length) return { threads: (await readReview(id)).length, pending: 0 }
  const worktree = reviewWorktree(id)
  if (!existsSync(path.join(worktree, '.git'))) {
    await mkdir(path.dirname(worktree), { recursive: true })
    const localBranch = await gitCommand(directory, ['show-ref', '--verify', '--quiet', 'refs/heads/texloom-reviews']).then(() => true).catch(() => false)
    if (localBranch) await gitCommand(directory, ['worktree', 'add', worktree, 'texloom-reviews'], 120000)
    else if (remoteBranch) await gitCommand(directory, ['worktree', 'add', '-b', 'texloom-reviews', '--track', worktree, 'origin/texloom-reviews'], 120000)
    else await gitCommand(directory, ['worktree', 'add', '--orphan', '-b', 'texloom-reviews', worktree], 120000)
  }
  if (remoteBranch) await gitCommand(worktree, ['pull', '--rebase', 'origin', 'texloom-reviews'], 120000)
  const eventsDir = await checkedReviewEventsDirectory(id)
  await mkdir(eventsDir, { recursive: true })
  for (const event of queued) {
    const file = path.join(eventsDir, `${event.id}.json`)
    if (existsSync(file)) {
      const details = await lstat(file)
      if (!details.isFile() || details.isSymbolicLink() || details.size > 64 * 1024) fail(422, '审阅事件文件无效')
      const existing = JSON.parse(await readFile(file, 'utf8')) as ReviewEvent
      if (JSON.stringify(existing) !== JSON.stringify(event)) fail(409, `审阅事件 ID 冲突：${event.id}`)
    } else await writeFile(file, JSON.stringify(event), 'utf8')
  }
  if (queued.length) {
    await gitCommand(worktree, ['add', '--', '.texloom/reviews/events'])
    const hasChanges = await gitCommand(worktree, ['diff', '--cached', '--quiet']).then(() => false).catch(() => true)
    if (hasChanges) await gitCommand(worktree, ['-c', `user.name=${await reviewActor(id)}`, '-c', 'user.email=texloom@users.noreply.github.com', 'commit', '-m', `TeXloom: sync ${queued.length} review event(s)`])
  }
  const ahead = remoteBranch ? Number(await gitCommand(worktree, ['rev-list', '--count', 'origin/texloom-reviews..HEAD'])) : 1
  if (ahead > 0) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await gitCommand(worktree, ['push', '-u', 'origin', 'texloom-reviews'], 120000); break }
      catch (error) {
        if (attempt === 2) throw error
        await gitCommand(worktree, ['fetch', 'origin', 'texloom-reviews'], 120000)
        try { await gitCommand(worktree, ['rebase', 'origin/texloom-reviews'], 120000) }
        catch (rebaseError) { await gitCommand(worktree, ['rebase', '--abort']).catch(() => {}); throw rebaseError }
      }
    }
  }
  for (const event of queued) await rm(path.join(outbox, `${event.id}.json`), { force: true })
  return materializeReviewEvents(id)
}

async function readSnapshots(id: string): Promise<Snapshot[]> {
  try { return JSON.parse(await readFile(path.join(projectDir(id), '.openleaf', 'history', 'index.json'), 'utf8')) as Snapshot[] }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

async function createSnapshot(project: Project, note: string): Promise<Snapshot> {
  const directory = path.join(projectDir(project.id), '.openleaf', 'history')
  await mkdir(directory, { recursive: true })
  const files = (await listProjectFiles(project.id)).filter(item => item.type === 'file')
  const archive = new AdmZip()
  for (const file of files) archive.addLocalFile(await safeFile(project.id, file.path), path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path))
  const snapshot: Snapshot = { id: randomUUID(), note: note.trim().slice(0, 120) || '手动快照', createdAt: new Date().toISOString(), fileCount: files.length }
  archive.writeZip(path.join(directory, `${snapshot.id}.zip`))
  const index = [snapshot, ...await readSnapshots(project.id)]
  await writeFile(path.join(directory, 'index.json'), JSON.stringify(index, null, 2), 'utf8')
  return snapshot
}

function redactGitOutput(value: string): string {
  return value.replace(/https:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://***@').replace(/\b(?:github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]+/g, '[已隐藏凭据]')
}

async function gitCommand(directory: string, args: string[], timeout = 30000, interactive = false): Promise<string> {
  const child = spawn('git', args, { cwd: directory, shell: false, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: interactive ? 'Auto' : 'Never' } })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-100_000) })
  child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-100_000) })
  const timer = setTimeout(() => child.kill(), timeout)
  try {
    const code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? -1)) })
    if (code !== 0) fail(422, redactGitOutput(output.trim()) || `Git 命令失败（${code}）`)
    return redactGitOutput(output.trim())
  } finally { clearTimeout(timer) }
}

async function listProjectFiles(id: string): Promise<FileEntry[]> {
  const result: FileEntry[] = []
  async function visit(dir: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!prefix && (entry.name === '.openleaf' || entry.name === '.git' || entry.name === 'project.json')) continue
      if (entry.isSymbolicLink()) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        result.push({ path: relative, type: 'directory' })
        await visit(path.join(dir, entry.name), relative)
      } else if (entry.isFile()) {
        result.push({ path: relative, type: 'file', size: (await stat(path.join(dir, entry.name))).size })
      }
    }
  }
  await visit(projectDir(id))
  return result.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
}

function defaultTex(name: string): string {
  return `\\documentclass[12pt,a4paper]{article}\n\\usepackage[UTF8]{ctex}\n\\usepackage{geometry}\n\\geometry{margin=2.5cm}\n\\title{${name.replace(/[{}\\]/g, '')}}\n\\author{TeXloom}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\\section{开始写作}\n在这里编写你的 LaTeX 文档。\n\\end{document}\n`
}

async function createProject(name: string): Promise<Project> {
  const clean = name.trim()
  if (!clean || clean.length > 80) fail(400, '项目名称须为 1 至 80 个字符')
  const now = new Date().toISOString()
  const project: Project = { id: randomUUID(), name: clean, mainFile: 'main.tex', createdAt: now, updatedAt: now, archived: false, tags: [] }
  await mkdir(projectDir(project.id), { recursive: true })
  await writeFile(path.join(projectDir(project.id), 'main.tex'), defaultTex(clean), 'utf8')
  await saveProject(project)
  return project
}

async function localGitExclude(directory: string): Promise<void> {
  const file = path.join(directory, '.git', 'info', 'exclude')
  const current = await readFile(file, 'utf8').catch(() => '')
  const additions = ['.openleaf/', 'project.json'].filter(entry => !current.split(/\r?\n/).includes(entry))
  if (additions.length) await writeFile(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${additions.join('\n')}\n`, 'utf8')
}

async function ensureProjectGitIgnore(directory: string): Promise<boolean> {
  for (const internal of ['.openleaf', 'project.json', '.gitignore']) {
    try {
      if ((await lstat(path.join(directory, internal))).isSymbolicLink()) fail(422, `仓库包含不安全的 ${internal} 符号链接`)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  if (await gitCommand(directory, ['ls-files', '--', '.openleaf']).catch(() => '')) fail(422, '仓库不应跟踪 .openleaf 内部数据')
  const ignore = path.join(directory, '.gitignore')
  const existing = existsSync(ignore) ? await readFile(ignore, 'utf8') : ''
  const missing = ['.openleaf/', 'project.json'].filter(entry => !existing.split(/\r?\n/).includes(entry))
  if (missing.length) await writeFile(ignore, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`, 'utf8')
  await localGitExclude(directory)
  const tracked = await gitCommand(directory, ['ls-files', '--error-unmatch', '--', 'project.json']).then(() => true).catch(() => false)
  if (tracked) await gitCommand(directory, ['rm', '--cached', '--', 'project.json'])
  return tracked
}

async function projectAfterBranchSwitch(project: Project): Promise<Project> {
  const files = await listProjectFiles(project.id)
  if (!files.some(item => item.path === project.mainFile)) {
    const main = files.find(item => item.type === 'file' && item.path === 'main.tex')?.path ?? files.find(item => item.type === 'file' && item.path.endsWith('.tex'))?.path
    if (!main) fail(409, '该分支没有 .tex 文件')
    project.mainFile = main
    await saveProject(project)
  }
  return project
}

async function clearCompiledPreview(id: string): Promise<void> {
  const output = path.join(projectDir(id), '.openleaf')
  try { const item = await lstat(output); if (!item.isDirectory() || item.isSymbolicLink()) fail(422, '项目内部目录不安全') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  await rm(path.join(output, 'output.pdf'), { force: true })
  await rm(path.join(output, 'output.synctex.gz'), { force: true })
}

async function assertSafeBranchTree(directory: string, ref: string): Promise<void> {
  const tree = await gitCommand(directory, ['ls-tree', ref, '--', '.openleaf', 'project.json', '.gitignore'])
  for (const row of tree.split(/\r?\n/)) {
    if (!row) continue
    const [metadata, file] = row.split('\t')
    if (file === '.openleaf') fail(422, '目标分支包含 .openleaf 内部数据')
    if (metadata.startsWith('120000 ') && (file === 'project.json' || file === '.gitignore')) fail(422, `目标分支包含不安全的 ${file} 符号链接`)
  }
}

async function assertCollaborationRemote(directory: string): Promise<string> {
  const remote = await gitCommand(directory, ['remote', 'get-url', 'origin']).catch(() => fail(400, '请先设置 GitHub 远程仓库'))
  try { githubRemote(remote); return remote }
  catch {
    if (process.env.TEXLOOM_TEST_LOCAL_GIT === '1' && path.isAbsolute(remote)) return remote
    fail(400, '协作同步仅支持 github.com HTTPS 或 SSH 仓库')
  }
}

async function runCompile(job: Job, project: Project): Promise<void> {
  const dir = projectDir(project.id)
  const outDir = path.join(dir, '.openleaf', 'build', job.id)
  await mkdir(outDir, { recursive: true })
  const input = await safeFile(project.id, project.mainFile)
  const args = ['-X', 'compile', '--untrusted', '--synctex', '--outdir', outDir, input]
  const child = spawn(tectonicPath, args, { cwd: dir, shell: false, windowsHide: true, env: { ...process.env, TECTONIC_UNTRUSTED_MODE: '1' } })
  const append = (chunk: Buffer) => { job.log = (job.log + chunk.toString('utf8')).slice(-250_000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  const timer = setTimeout(() => { job.log += '\n编译超时（600 秒），已终止。'; child.kill() }, 600_000)
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => resolve(code ?? -1))
    })
    if (code !== 0) fail(422, job.log || `Tectonic 退出代码：${code}`)
    const pdf = path.join(outDir, `${path.basename(project.mainFile, '.tex')}.pdf`)
    if (!existsSync(pdf)) fail(422, '编译完成，但未找到生成的 PDF')
    const finalPdf = path.join(dir, '.openleaf', 'output.pdf')
    await copyFile(pdf, `${finalPdf}.tmp`)
    await rename(`${finalPdf}.tmp`, finalPdf)
    const sourceMap = path.join(outDir, `${path.basename(project.mainFile, '.tex')}.synctex.gz`)
    const finalMap = path.join(dir, '.openleaf', 'output.synctex.gz')
    if (existsSync(sourceMap)) {
      await copyFile(sourceMap, `${finalMap}.tmp`)
      await rename(`${finalMap}.tmp`, finalMap)
    } else await rm(finalMap, { force: true })
    job.status = 'success'
  } catch (error) {
    job.status = 'error'
    const detail = error instanceof Error ? error.message : String(error)
    if (!job.log.includes(detail)) job.log += `\n${detail}`
  } finally {
    clearTimeout(timer)
    job.finishedAt = new Date().toISOString()
    activeProjects.delete(project.id)
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  }
}

await mkdir(projectsRoot, { recursive: true })
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } })
app.setErrorHandler((error, _request, reply) => {
  const err = error as Error & { statusCode?: number }
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
  reply.code(status).send({ error: status === 500 ? '服务器内部错误' : err.message })
})

app.get('/api/health', async () => ({ ok: true, tectonic: existsSync(tectonicPath), version: '0.1.0' }))

app.get('/api/ai/settings', async () => {
  const settings = await readAiSettings(root)
  return { configured: Boolean(settings.encryptedKey), model: settings.model, maxOutputTokens: settings.maxOutputTokens, timeoutSeconds: settings.timeoutSeconds }
})
app.put<{ Body: { apiKey?: string; clearKey?: boolean; model: string; maxOutputTokens: number; timeoutSeconds: number } }>('/api/ai/settings', async request => {
  const input = request.body
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(input?.model ?? '') || !Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 256 || input.maxOutputTokens > 8192 || !Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 10 || input.timeoutSeconds > 180) fail(400, 'AI 设置无效')
  const settings = await readAiSettings(root)
  settings.model = input.model
  settings.maxOutputTokens = input.maxOutputTokens
  settings.timeoutSeconds = input.timeoutSeconds
  if (input.clearKey) delete settings.encryptedKey
  else if (input.apiKey?.trim()) {
    if (input.apiKey.length > 300) fail(400, 'API Key 过长')
    settings.encryptedKey = await protectKey(input.apiKey.trim())
  }
  await saveAiSettings(root, settings)
  return { configured: Boolean(settings.encryptedKey), model: settings.model, maxOutputTokens: settings.maxOutputTokens, timeoutSeconds: settings.timeoutSeconds }
})

app.post<{ Body: { mode: 'chat' | 'translate' | 'polish' | 'explain' | 'rewrite' | 'formula' | 'table' | 'custom'; prompt?: string; selectedText?: string; context?: string; imageDataUrl?: string } }>('/api/ai/chat', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
  const input = request.body
  const modes = new Set(['chat', 'translate', 'polish', 'explain', 'rewrite', 'formula', 'table', 'custom'])
  if (!modes.has(input?.mode) || typeof input.prompt !== 'string' || typeof input.selectedText !== 'string' || typeof input.context !== 'string' || input.prompt.length > 10000 || input.selectedText.length > 30000 || input.context.length > 15000 || !(input.prompt.trim() || input.selectedText.trim() || input.context.trim() || input.imageDataUrl)) fail(400, 'AI 请求内容无效')
  if (input.imageDataUrl) {
    if (input.mode !== 'table' || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(input.imageDataUrl) || input.imageDataUrl.length > 11_000_000) fail(400, '表格图片仅支持 8 MB 以内的 PNG 或 JPEG')
    const bytes = Buffer.from(input.imageDataUrl.slice(input.imageDataUrl.indexOf(',') + 1), 'base64')
    if (bytes.length > 8 * 1024 * 1024 || !(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes[0] === 255 && bytes[1] === 216)) fail(400, '图片内容无效')
  }
  const settings = await readAiSettings(root)
  if (!settings.encryptedKey) fail(400, '请先在设置中填写 DeepSeek API Key')
  const key = await unprotectKey(settings.encryptedKey)
  const instructions: Record<string, string> = {
    chat: '你是 LaTeX 学术写作助手。用中文简洁回答，涉及源码时保持命令准确。',
    translate: '将给定内容翻译为学术中文或用户指定的语言。保留 LaTeX 命令、数学公式、引用键与标签。只输出翻译结果。',
    polish: '润色学术写作，保留原意和所有 LaTeX 命令、数学公式、引用键与标签。只输出修改后的文本。',
    explain: '解释给定的 LaTeX 或 Tectonic 编译错误，指出原因与可执行的修复步骤。',
    rewrite: '根据用户要求修改给定 LaTeX 源码。只输出可替换选区的 LaTeX 源码，不要 Markdown 代码围栏。',
    formula: '根据用户描述生成可编译的 LaTeX 公式。只输出公式源码，不要 Markdown 代码围栏。',
    table: '根据用户描述生成可编译的 LaTeX 表格。只输出表格源码，不要 Markdown 代码围栏。',
    custom: '按照用户的自定义指令处理给定的 LaTeX 内容。若要求修改源码，只输出替换后的源码。',
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000)
  let upstream: Response
  try {
    upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, stream: true, max_tokens: settings.maxOutputTokens, messages: [
        { role: 'system', content: instructions[input.mode] },
        { role: 'user', content: input.imageDataUrl ? [
          { type: 'text', text: `请识别图片中的表格，生成可编译的 LaTeX table/tabular 源码。${input.prompt.trim()}` },
          { type: 'image_url', image_url: { url: input.imageDataUrl } },
        ] : `用户要求：${input.prompt.trim() || '处理以下内容'}\n\n选中内容：\n${input.selectedText}\n\n额外上下文：\n${input.context}` },
      ] }),
    })
    if (!upstream.ok || !upstream.body) fail(502, `DeepSeek 请求失败（${upstream.status}）：${(await upstream.text()).slice(0, 300)}`)
    reply.hijack()
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
    reply.raw.on('close', () => controller.abort())
    const reader = upstream.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      reply.raw.write(Buffer.from(value))
    }
    reply.raw.end()
  } catch (error) {
    if (reply.raw.headersSent) { reply.raw.write(`\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`); reply.raw.end(); return }
    throw error
  } finally { clearTimeout(timer) }
})

app.get('/api/projects', async () => {
  const projects: Project[] = []
  for (const entry of await readdir(projectsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name)) {
      try { projects.push(await projectForList(await getProject(entry.name))) } catch { /* ignore incomplete project */ }
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

app.get('/api/project-tags', async () => readTags())
app.post<{ Body: { name: string } }>('/api/project-tags', async request => {
  const name = validTag(request.body?.name)
  const tags = await readTags()
  if (tags.includes(name)) fail(409, '标签已存在')
  if (tags.length >= 100) fail(413, '标签数量已达上限')
  await writeTags([...tags, name])
  return { name }
})
app.patch<{ Params: { name: string }; Body: { name: string } }>('/api/project-tags/:name', async request => {
  const original = validTag(request.params.name)
  const replacement = validTag(request.body?.name)
  const tags = await readTags()
  if (!tags.includes(original)) fail(404, '标签不存在')
  if (replacement !== original && tags.includes(replacement)) fail(409, '标签已存在')
  await writeTags(tags.map(item => item === original ? replacement : item))
  for (const entry of await readdir(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue
    const project = await getProject(entry.name)
    if (project.tags?.includes(original)) { project.tags = project.tags.map(item => item === original ? replacement : item); await saveProject(project) }
  }
  return { name: replacement }
})
app.delete<{ Params: { name: string } }>('/api/project-tags/:name', async request => {
  const name = validTag(request.params.name)
  const tags = await readTags()
  if (!tags.includes(name)) fail(404, '标签不存在')
  await writeTags(tags.filter(item => item !== name))
  for (const entry of await readdir(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue
    const project = await getProject(entry.name)
    if (project.tags?.includes(name)) { project.tags = project.tags.filter(item => item !== name); await saveProject(project) }
  }
  return { ok: true }
})

app.post<{ Body: { mode: 'import' | 'export'; testPath?: string } }>('/api/folders/select', async request => {
  if (request.body?.mode !== 'import' && request.body?.mode !== 'export') fail(400, '文件夹操作无效')
  const chosen = process.env.TEXLOOM_TEST_FOLDER_PICKER === '1' && request.body.testPath && path.isAbsolute(request.body.testPath)
    ? await realpath(request.body.testPath) : await chooseWindowsFolder(request.body.mode)
  if (!chosen) return { cancelled: true }
  const details = await lstat(chosen)
  if (!details.isDirectory() || details.isSymbolicLink()) fail(400, '请选择普通文件夹')
  const token = randomUUID()
  folderSelections.set(token, { path: chosen, mode: request.body.mode, expires: Date.now() + 10 * 60_000 })
  return { token, name: path.basename(chosen) || chosen }
})

app.post<{ Body: { token: string } }>('/api/folders/inspect', async request => {
  const directory = selectedFolder(request.body?.token, 'import')
  const candidates = await folderCandidates(directory)
  if (!candidates.length) fail(400, '所选文件夹及其直接子文件夹中没有 LaTeX 项目')
  return { candidates: candidates.map(item => ({ name: item.name, files: item.files.length, bytes: item.bytes, mainFile: item.mainFile })) }
})

app.post<{ Body: { token: string } }>('/api/folders/import', async request => {
  const directory = selectedFolder(request.body?.token, 'import')
  const candidates = await folderCandidates(directory)
  if (!candidates.length) fail(400, '没有可导入的 LaTeX 项目')
  const imported: Project[] = []
  const failed: { name: string; error: string }[] = []
  for (const candidate of candidates) {
    let project: Project | null = null
    try {
      project = await createProject(candidate.name || '本地项目')
      await rm(path.join(projectDir(project.id), 'main.tex'), { force: true })
      for (const file of candidate.files) {
        const source = await realpath(file.absolute)
        const relative = path.relative(candidate.directory, source)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await lstat(source)).isFile()) fail(400, '源文件已变化，请重新选择文件夹')
        const destination = await safeFile(project.id, file.relative)
        await mkdir(path.dirname(destination), { recursive: true })
        await copyFile(source, destination)
      }
      project.mainFile = candidate.mainFile
      if (candidate.metadata?.sharing === 'personal' || candidate.metadata?.sharing === 'shared') project.sharing = candidate.metadata.sharing
      if (typeof candidate.metadata?.archived === 'boolean') project.archived = candidate.metadata.archived
      if (Array.isArray(candidate.metadata?.tags)) {
        project.tags = [...new Set(candidate.metadata.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => validTag(tag)))].slice(0, 20)
        const known = await readTags()
        const additions = project.tags.filter(tag => !known.includes(tag))
        if (known.length + additions.length > 100) fail(413, '标签数量已达上限，无法恢复项目标签')
        if (additions.length) await writeTags([...known, ...additions])
      }
      await saveProject(project)
      imported.push(project)
    } catch (error) {
      failed.push({ name: candidate.name, error: error instanceof Error ? error.message : String(error) })
      if (project) await rm(projectDir(project.id), { recursive: true, force: true })
    }
  }
  folderSelections.delete(request.body.token)
  return { imported, failed }
})

app.post<{ Body: { token: string; projectIds: string[] } }>('/api/folders/export', async request => {
  const directory = selectedFolder(request.body?.token, 'export')
  const insideProjects = path.relative(projectsRoot, directory)
  if (!insideProjects.startsWith('..') && !path.isAbsolute(insideProjects)) fail(400, '导出目标不能位于项目数据目录内')
  if (!Array.isArray(request.body?.projectIds) || !request.body.projectIds.length || request.body.projectIds.length > 30) fail(400, '请选择 1 至 30 个项目')
  const ids = [...new Set(request.body.projectIds)]
  const exported: { id: string; folder: string; files: number }[] = []
  const failed: { id: string; error: string }[] = []
  for (const id of ids) {
    let temporary = ''
    try {
      const project = await getProject(id)
      const base = project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 80) || 'project'
      let final = path.join(directory, base)
      for (let index = 2; existsSync(final); index++) final = path.join(directory, `${base} (${index})`)
      temporary = path.join(directory, `.texloom-export-${randomUUID()}`)
      if (path.dirname(path.resolve(temporary)) !== path.resolve(directory) || path.dirname(path.resolve(final)) !== path.resolve(directory)) fail(400, '导出路径无效')
      await mkdir(temporary)
      const files = (await listProjectFiles(id)).filter(item => item.type === 'file')
      if (files.some(item => item.path === '.texloom-project.json')) fail(409, '项目中已有 .texloom-project.json 文件，无法安全写入导出元数据')
      for (const item of files) {
        const source = await safeFile(id, item.path)
        const destination = path.join(temporary, item.path)
        await mkdir(path.dirname(destination), { recursive: true })
        await copyFile(source, destination)
      }
      await writeFile(path.join(temporary, '.texloom-project.json'), JSON.stringify({ name: project.name, mainFile: project.mainFile, sharing: project.sharing ?? 'personal', archived: Boolean(project.archived), tags: project.tags ?? [] }, null, 2), 'utf8')
      await rename(temporary, final)
      exported.push({ id, folder: path.basename(final), files: files.length })
      temporary = ''
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : String(error) })
      if (temporary && path.dirname(path.resolve(temporary)) === path.resolve(directory) && path.basename(temporary).startsWith('.texloom-export-')) await rm(temporary, { recursive: true, force: true })
    }
  }
  folderSelections.delete(request.body.token)
  return { exported, failed }
})

app.post<{ Body: { name: string } }>('/api/projects', async request => createProject(request.body?.name ?? ''))
app.post<{ Body: { url: string } }>('/api/git/connect', async request => {
  const remote = githubRemote(request.body?.url)
  await gitCommand(root, ['ls-remote', '--heads', remote.url], 120000, true)
  return { ok: true, repository: `${remote.owner}/${remote.repo}` }
})
app.post<{ Body: { url: string } }>('/api/projects/clone', async request => {
  const remote = githubRemote(request.body?.url)
  const now = new Date().toISOString()
  const id = randomUUID()
  const directory = projectDir(id)
  try {
    await gitCommand(projectsRoot, ['clone', '--', remote.url, directory], 180000)
    const migratedMetadata = await ensureProjectGitIgnore(directory)
    if (migratedMetadata) await gitCommand(directory, ['switch', '-c', `feature/texloom-import-${id.slice(0, 8)}`])
    const files = await listProjectFiles(id)
    const mainFile = files.find(item => item.type === 'file' && item.path === 'main.tex')?.path ?? files.find(item => item.type === 'file' && item.path.endsWith('.tex'))?.path
    if (!mainFile) fail(400, '远程仓库没有 .tex 文件')
    const project: Project = { id, name: remote.repo, mainFile, createdAt: now, updatedAt: now, sharing: 'shared', archived: false, tags: [] }
    await saveProject(project)
    return project
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
})
app.get<{ Params: { id: string } }>('/api/projects/:id', async request => getProject(request.params.id))
app.patch<{ Params: { id: string }; Body: { name?: string; mainFile?: string; sharing?: 'personal' | 'shared'; archived?: boolean; tags?: string[] } }>('/api/projects/:id', async request => {
  const project = await getProject(request.params.id)
  if (request.body?.name !== undefined) {
    const name = request.body.name.trim()
    if (!name || name.length > 80) fail(400, '项目名称须为 1 至 80 个字符')
    project.name = name
  }
  if (request.body?.mainFile !== undefined) {
    const mainFile = safeRelative(request.body.mainFile)
    if (!mainFile.endsWith('.tex')) fail(400, '主文件必须是 .tex 文件')
    const file = await safeFile(project.id, mainFile)
    if (!existsSync(file)) fail(404, '主文件不存在')
    project.mainFile = mainFile
  }
  if (request.body?.sharing !== undefined) {
    if (request.body.sharing !== 'personal' && request.body.sharing !== 'shared') fail(400, '项目分类无效')
    project.sharing = request.body.sharing
  }
  if (request.body?.archived !== undefined) {
    if (typeof request.body.archived !== 'boolean') fail(400, '归档状态无效')
    project.archived = request.body.archived
  }
  if (request.body?.tags !== undefined) {
    if (!Array.isArray(request.body.tags) || request.body.tags.length > 20) fail(400, '项目标签无效')
    const available = await readTags()
    const tags = request.body.tags.map(validTag)
    if (tags.some(tag => !available.includes(tag))) fail(400, '存在未创建的标签')
    project.tags = [...new Set(tags)]
  }
  await saveProject(project)
  return project
})
app.delete<{ Params: { id: string } }>('/api/projects/:id', async request => {
  await getProject(request.params.id)
  if (activeProjects.has(request.params.id)) fail(409, '项目正在编译')
  await rm(projectDir(request.params.id), { recursive: true, force: true })
  return { ok: true }
})

app.get<{ Params: { id: string } }>('/api/projects/:id/files', async request => {
  await getProject(request.params.id)
  return listProjectFiles(request.params.id)
})
app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/file', async request => {
  await getProject(request.params.id)
  const file = await safeFile(request.params.id, request.query.path)
  try {
    if ((await stat(file)).size > 2 * 1024 * 1024) fail(413, '文本文件过大')
    const data = await readFile(file)
    if (data.includes(0)) fail(415, '此文件不是文本文件')
    return { content: data.toString('utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail(404, '文件不存在')
    throw error
  }
})
app.put<{ Params: { id: string }; Querystring: { path: string }; Body: { content: string } }>('/api/projects/:id/file', async request => {
  const project = await getProject(request.params.id)
  const file = await safeFile(project.id, request.query.path)
  if (typeof request.body?.content !== 'string') fail(400, '缺少文件内容')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, request.body.content, 'utf8')
  await saveProject(project)
  return { ok: true }
})
app.delete<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/file', async request => {
  const project = await getProject(request.params.id)
  const relative = safeRelative(request.query.path)
  if (relative === project.mainFile) fail(400, '不能删除当前主文件')
  const file = await safeFile(project.id, relative)
  await rm(file, { force: true, recursive: true })
  await saveProject(project)
  return { ok: true }
})
app.post<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/upload', async request => {
  const project = await getProject(request.params.id)
  const file = await safeFile(project.id, request.query.path)
  const upload = await request.file()
  if (!upload) fail(400, '请选择文件')
  const bytes = await upload.toBuffer()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, bytes)
  await saveProject(project)
  return { ok: true }
})

app.post<{ Params: { id: string }; Body: { sourceProjectId: string; sourcePath: string } }>('/api/projects/:id/copy-image', async request => {
  const project = await getProject(request.params.id)
  await getProject(request.body?.sourceProjectId)
  const sourcePath = safeRelative(request.body?.sourcePath)
  const source = await safeFile(request.body.sourceProjectId, sourcePath)
  const sourceInfo = await stat(source).catch(() => fail(404, '来源图片不存在'))
  if (!sourceInfo.isFile() || sourceInfo.size > 20 * 1024 * 1024) fail(400, '图片大小超过限制')
  const destination = imageDestination(project.id, sourcePath)
  await mkdir(path.dirname(destination.absolute), { recursive: true })
  await copyFile(source, destination.absolute)
  await saveProject(project)
  return { path: destination.relative }
})

app.post<{ Params: { id: string }; Body: { url: string } }>('/api/projects/:id/import-image-url', async request => {
  const project = await getProject(request.params.id)
  let url: URL
  try { url = new URL(request.body?.url) } catch { fail(400, '图片 URL 无效') }
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || isIP(url.hostname) || url.hostname === 'localhost' || url.hostname.endsWith('.local')) fail(400, '只支持公开 HTTPS 图片地址')
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(item => !isPublicIp(item.address))) fail(400, '图片地址不可访问')
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
  if (!response.ok) fail(400, `下载图片失败（${response.status}）`)
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'application/pdf': '.pdf' } as Record<string, string>)[contentType ?? '']
  if (!extension) fail(400, 'URL 必须返回 PNG、JPEG 或 PDF')
  if (Number(response.headers.get('content-length') ?? 0) > 20 * 1024 * 1024) fail(413, '图片大小超过 20 MB')
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  if (!reader) fail(400, '图片响应为空')
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 20 * 1024 * 1024) { await reader.cancel(); fail(413, '图片大小超过 20 MB') }
    chunks.push(value)
  }
  const baseName = path.basename(url.pathname).replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]/gu, '-').slice(-70) || 'image'
  const destination = imageDestination(project.id, `${baseName}${extension}`)
  await mkdir(path.dirname(destination.absolute), { recursive: true })
  await writeFile(destination.absolute, Buffer.concat(chunks))
  await saveProject(project)
  return { path: destination.relative }
})

app.get<{ Params: { id: string } }>('/api/projects/:id/review', async request => {
  await getProject(request.params.id)
  return visibleReviews(request.params.id)
})
app.get<{ Params: { id: string } }>('/api/projects/:id/review/author', async request => {
  await getProject(request.params.id)
  return { name: await reviewActor(request.params.id) }
})
app.put<{ Params: { id: string }; Body: { name: string } }>('/api/projects/:id/review/author', async request => {
  await getProject(request.params.id)
  const name = request.body?.name?.trim()
  if (!name || name.length > 100 || /[\r\n\x00-\x1f]/.test(name)) fail(400, '审阅署名须为 1 至 100 个字符')
  const directory = path.join(projectDir(request.params.id), '.openleaf')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'author.txt'), name, 'utf8')
  return { name }
})
app.post<{ Params: { id: string }; Body: { file: string; line: number; column: number; offset: number; original: string; body: string; proposed?: string; type: 'comment' | 'suggestion' } }>('/api/projects/:id/review', async request => {
  const project = await getProject(request.params.id)
  return withReviewLock(project.id, async () => {
  const input = request.body
  const file = safeRelative(input?.file)
  if (input.type !== 'comment' && input.type !== 'suggestion') fail(400, '审阅类型无效')
  if (!Number.isInteger(input.line) || input.line < 1 || !Number.isInteger(input.column) || input.column < 1 || !Number.isInteger(input.offset) || input.offset < 0) fail(400, '审阅位置无效')
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 4000 || typeof input.original !== 'string' || input.original.length > 20000) fail(400, '审阅内容无效')
  if (input.type === 'suggestion' && (typeof input.proposed !== 'string' || input.proposed.length > 20000)) fail(400, '修改建议无效')
  await safeFile(project.id, file)
  await ensureReviewMigration(project.id)
  const threads = await readReview(project.id)
  const thread: ReviewThread = { id: randomUUID(), file, line: input.line, column: input.column, offset: input.offset, original: input.original, body: input.body.trim(), author: await reviewActor(project.id), proposed: input.type === 'suggestion' ? input.proposed : undefined, type: input.type, status: 'open', createdAt: new Date().toISOString(), replies: [], target: await reviewTarget(project.id, file) }
  threads.unshift(thread)
  await appendReviewEvent(project.id, makeReviewEvent('thread.created', thread.id, await reviewActor(project.id), { thread }))
  await writeReview(project.id, threads)
  return thread
  })
})
app.patch<{ Params: { id: string; threadId: string }; Body: { action: 'reply' | 'resolve' | 'reopen' | 'accept' | 'reject'; body?: string } }>('/api/projects/:id/review/:threadId', async request => {
  const project = await getProject(request.params.id)
  return withReviewLock(project.id, async () => {
  await ensureReviewMigration(project.id)
  const threads = await readReview(project.id)
  const thread = threads.find(item => item.id === request.params.threadId)
  if (!thread) fail(404, '评论不存在')
  const action = request.body?.action
  let event: ReviewEvent
  if (action === 'reply') {
    const body = request.body.body?.trim()
    if (!body || body.length > 4000) fail(400, '回复内容无效')
    const reply = { id: randomUUID(), body, author: await reviewActor(project.id), createdAt: new Date().toISOString() }
    thread.replies.push(reply)
    event = makeReviewEvent('reply.added', thread.id, await reviewActor(project.id), { reply })
  } else if (action === 'resolve' || action === 'reopen') { thread.status = action === 'resolve' ? 'resolved' : 'open'; event = makeReviewEvent('thread.status', thread.id, await reviewActor(project.id), { status: thread.status }) }
  else if (action === 'reject') { if (thread.type !== 'suggestion') fail(400, '这不是修改建议'); thread.status = 'rejected'; event = makeReviewEvent('thread.status', thread.id, await reviewActor(project.id), { status: thread.status }) }
  else if (action === 'accept') {
    if (thread.type !== 'suggestion' || thread.proposed === undefined || thread.status !== 'open') fail(400, '修改建议不可接受')
    const file = await safeFile(project.id, thread.file)
    const source = await readFile(file, 'utf8')
    if (source.slice(thread.offset, thread.offset + thread.original.length) !== thread.original) fail(409, '原文已改变，请重新创建修改建议')
    await writeFile(file, `${source.slice(0, thread.offset)}${thread.proposed}${source.slice(thread.offset + thread.original.length)}`, 'utf8')
    thread.status = 'accepted'
    event = makeReviewEvent('thread.status', thread.id, await reviewActor(project.id), { status: thread.status })
    await saveProject(project)
  } else fail(400, '审阅操作无效')
  await appendReviewEvent(project.id, event)
  await writeReview(project.id, threads)
  return thread
  })
})

app.get<{ Params: { id: string } }>('/api/projects/:id/history', async request => {
  await getProject(request.params.id)
  return readSnapshots(request.params.id)
})
app.post<{ Params: { id: string }; Body: { note?: string } }>('/api/projects/:id/history', async request => {
  const project = await getProject(request.params.id)
  return createSnapshot(project, request.body?.note ?? '')
})
app.post<{ Params: { id: string; snapshotId: string } }>('/api/projects/:id/history/:snapshotId/restore', async request => {
  const project = await getProject(request.params.id)
  const item = (await readSnapshots(project.id)).find(snapshot => snapshot.id === request.params.snapshotId)
  if (!item) fail(404, '快照不存在')
  const file = path.join(projectDir(project.id), '.openleaf', 'history', `${item.id}.zip`)
  if (!existsSync(file)) fail(404, '快照文件不存在')
  await createSnapshot(project, `恢复前备份：${item.note}`)
  const archive = new AdmZip(file)
  const contents = new Map<string, Buffer>()
  for (const entry of archive.getEntries()) {
    if (entry.isDirectory) continue
    const relative = safeRelative(entry.entryName)
    contents.set(relative, entry.getData())
  }
  const current = (await listProjectFiles(project.id)).filter(entry => entry.type === 'file')
  for (const entry of current) if (!contents.has(entry.path)) await rm(await safeFile(project.id, entry.path), { force: true })
  for (const [relative, bytes] of contents) {
    const target = await safeFile(project.id, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  await saveProject(project)
  return { ok: true, restored: item.id }
})

app.get<{ Params: { id: string } }>('/api/projects/:id/git', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) return { initialized: false, branch: '', remote: '', status: '', commits: [] }
  const [branch, remote, status, log, author] = await Promise.all([
    gitCommand(directory, ['symbolic-ref', '--short', 'HEAD']).catch(() => ''),
    gitCommand(directory, ['remote', 'get-url', 'origin']).catch(() => ''),
    gitCommand(directory, ['status', '--short']),
    gitCommand(directory, ['log', '-20', '--date=iso-strict', '--format=%H%x09%h%x09%ad%x09%s']).catch(() => ''),
    gitCommand(directory, ['log', '-1', '--format=%an%x09%ae']).catch(() => ''),
  ])
  const commits = log ? log.split(/\r?\n/).map(line => { const [id, shortId, date, message] = line.split('\t'); return { id, shortId, date, message } }) : []
  const [authorName = '', authorEmail = ''] = author.split('\t')
  let safeRemote = ''
  try { safeRemote = githubRemote(remote).url } catch { if (remote) safeRemote = '不支持的远程地址' }
  return { initialized: true, branch, remote: safeRemote, status, commits, authorName, authorEmail }
})
app.post<{ Params: { id: string } }>('/api/projects/:id/git/init', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) await gitCommand(directory, ['init'])
  await ensureProjectGitIgnore(directory)
  return { ok: true }
})
app.post<{ Params: { id: string }; Body: { message: string; name: string; email: string } }>('/api/projects/:id/git/commit', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) fail(400, '请先初始化 Git 仓库')
  const { message, name, email } = request.body ?? {}
  if (!message?.trim() || message.length > 200 || !name?.trim() || name.length > 100 || !email?.trim() || email.length > 200) fail(400, '请填写提交说明、姓名和邮箱')
  await ensureProjectGitIgnore(directory)
  await gitCommand(directory, ['add', '--all'])
  const output = await gitCommand(directory, ['-c', `user.name=${name.trim()}`, '-c', `user.email=${email.trim()}`, 'commit', '-m', message.trim()])
  await mkdir(path.join(directory, '.openleaf'), { recursive: true })
  if (!existsSync(path.join(directory, '.openleaf', 'author.txt'))) await writeFile(path.join(directory, '.openleaf', 'author.txt'), name.trim(), 'utf8')
  return { ok: true, output }
})
app.post<{ Params: { id: string }; Body: { url: string } }>('/api/projects/:id/git/remote', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) fail(400, '请先初始化 Git 仓库')
  let url: string
  try { url = githubRemote(request.body?.url).url } catch (error) { fail(400, error instanceof Error ? error.message : '远程地址无效') }
  if (await gitCommand(directory, ['remote']).then(output => output.split(/\r?\n/).includes('origin'))) await gitCommand(directory, ['remote', 'set-url', 'origin', url])
  else await gitCommand(directory, ['remote', 'add', 'origin', url])
  return { ok: true }
})
app.post<{ Params: { id: string }; Body: { action: 'push' | 'pull' } }>('/api/projects/:id/git/sync', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) fail(400, '请先初始化 Git 仓库')
  if (request.body?.action !== 'push' && request.body?.action !== 'pull') fail(400, '同步操作无效')
  await assertCollaborationRemote(directory)
  if (request.body.action === 'pull' && await gitCommand(directory, ['status', '--porcelain'])) fail(409, '请先提交或清理本地改动')
  const branch = await gitCommand(directory, ['symbolic-ref', '--short', 'HEAD'])
  if (request.body.action === 'push' && (branch === 'main' || branch === 'master')) fail(409, '协作模式请先创建个人分支，再推送并发起 Pull Request')
  const output = request.body.action === 'push'
    ? await gitCommand(directory, ['push', '-u', 'origin', `HEAD:refs/heads/${safeBranch(branch)}`], 120000)
    : await gitCommand(directory, ['pull', '--ff-only'], 120000)
  const updatedProject = request.body.action === 'pull' ? await projectAfterBranchSwitch(project) : project
  if (request.body.action === 'pull') await clearCompiledPreview(project.id)
  try { return { ok: true, output, project: updatedProject, reviews: await withReviewLock(project.id, () => syncReviewEvents(project.id)) } }
  catch (error) { return { ok: true, output, project: updatedProject, reviewError: error instanceof Error ? error.message : String(error) } }
})
app.get<{ Params: { id: string } }>('/api/projects/:id/git/branches', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) fail(400, '请先初始化 Git 仓库')
  const [current, local, remote] = await Promise.all([
    gitCommand(directory, ['symbolic-ref', '--short', 'HEAD']).catch(() => ''),
    gitCommand(directory, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    gitCommand(directory, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']),
  ])
  return { current, local: local.split(/\r?\n/).filter(Boolean).filter(name => name !== 'texloom-reviews'), remote: remote.split(/\r?\n/).filter(name => name.startsWith('origin/') && name !== 'origin/HEAD' && name !== 'origin/texloom-reviews').map(name => name.slice(7)) }
})
app.post<{ Params: { id: string } }>('/api/projects/:id/git/fetch', async request => {
  const project = await getProject(request.params.id)
  await assertCollaborationRemote(projectDir(project.id))
  await gitCommand(projectDir(project.id), ['fetch', '--prune', 'origin'], 120000)
  return { ok: true }
})
app.post<{ Params: { id: string }; Body: { name: string; from?: string } }>('/api/projects/:id/git/branch', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  const name = safeBranch(request.body?.name)
  if (activeProjects.has(project.id)) fail(409, '项目正在编译，不能切换分支')
  if (await gitCommand(directory, ['status', '--porcelain'])) fail(409, '请先提交或清理本地改动')
  const from = request.body?.from ? `refs/remotes/origin/${safeBranch(request.body.from)}` : 'HEAD'
  await assertSafeBranchTree(directory, from)
  const metadata = await readFile(path.join(directory, 'project.json'))
  await gitCommand(directory, ['switch', '-c', name, from])
  await writeFile(path.join(directory, 'project.json'), metadata)
  await ensureProjectGitIgnore(directory)
  await clearCompiledPreview(project.id)
  return { ok: true, branch: name, project: await projectAfterBranchSwitch(project) }
})
app.post<{ Params: { id: string }; Body: { name: string } }>('/api/projects/:id/git/switch', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  const name = safeBranch(request.body?.name)
  if (activeProjects.has(project.id)) fail(409, '项目正在编译，不能切换分支')
  if (await gitCommand(directory, ['status', '--porcelain'])) fail(409, '请先提交或清理本地改动')
  const local = await gitCommand(directory, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).then(() => true).catch(() => false)
  await assertSafeBranchTree(directory, local ? `refs/heads/${name}` : `refs/remotes/origin/${name}`)
  const metadata = await readFile(path.join(directory, 'project.json'))
  if (local) await gitCommand(directory, ['switch', name])
  else await gitCommand(directory, ['switch', '--track', '-c', name, `origin/${name}`])
  await writeFile(path.join(directory, 'project.json'), metadata)
  await ensureProjectGitIgnore(directory)
  await clearCompiledPreview(project.id)
  return { ok: true, branch: name, project: await projectAfterBranchSwitch(project) }
})
app.get<{ Params: { id: string }; Querystring: { branch: string; path?: string; diff?: string } }>('/api/projects/:id/git/branch-view', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  const branch = safeBranch(request.query.branch)
  const commit = await gitCommand(directory, ['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`])
  if (request.query.path) {
    const file = safeRelative(request.query.path)
    if (request.query.diff === '1') return { branch, commit, path: file, diff: await gitCommand(directory, ['diff', '--no-ext-diff', '--unified=2', 'HEAD', commit, '--', file]) }
    const bytes = Number(await gitCommand(directory, ['cat-file', '-s', `${commit}:${file}`]))
    if (!Number.isFinite(bytes) || bytes > 80_000) fail(413, '远程文件太大，无法在侧栏预览')
    const content = await gitCommand(directory, ['show', `${commit}:${file}`])
    if (content.includes('\0')) fail(415, '不是文本文件')
    return { branch, commit, path: file, content }
  }
  const output = await gitCommand(directory, ['ls-tree', '-r', '--name-only', commit])
  return { branch, commit, files: output.split(/\r?\n/).filter(Boolean).filter(file => !file.startsWith('.openleaf/') && file !== 'project.json').slice(0, 2000) }
})
app.post<{ Params: { id: string } }>('/api/projects/:id/git/review-sync', async request => {
  const project = await getProject(request.params.id)
  const directory = projectDir(project.id)
  if (!existsSync(path.join(directory, '.git'))) fail(400, '请先初始化 Git 仓库')
  await assertCollaborationRemote(directory)
  try { return { ok: true, ...(await withReviewLock(project.id, () => syncReviewEvents(project.id))) } }
  catch (error) { fail(422, redactGitOutput(error instanceof Error ? error.message : String(error))) }
})

app.post<{ Params: { id: string } }>('/api/projects/:id/compile', async request => {
  const project = await getProject(request.params.id)
  if (!existsSync(tectonicPath)) fail(503, '未找到 runtime/tectonic.exe')
  if (activeProjects.has(project.id) || activeProjects.size >= 2) fail(409, '已有编译任务在运行')
  const main = await safeFile(project.id, project.mainFile)
  if (!existsSync(main)) fail(404, '主文件不存在')
  const job: Job = { id: randomUUID(), projectId: project.id, status: 'running', log: '', startedAt: new Date().toISOString() }
  jobs.set(job.id, job)
  activeProjects.add(project.id)
  void runCompile(job, project)
  return job
})
app.get<{ Params: { id: string; jobId: string } }>('/api/projects/:id/jobs/:jobId', async request => {
  await getProject(request.params.id)
  const job = jobs.get(request.params.jobId)
  if (!job || job.projectId !== request.params.id) fail(404, '编译任务不存在')
  return job
})
app.get<{ Params: { id: string } }>('/api/projects/:id/pdf', async (request, reply) => {
  await getProject(request.params.id)
  const file = path.join(projectDir(request.params.id), '.openleaf', 'output.pdf')
  if (!existsSync(file)) fail(404, '尚无成功编译的 PDF')
  return reply.header('Cache-Control', 'no-store').type('application/pdf').send(createReadStream(file))
})
app.get<{ Params: { id: string } }>('/api/projects/:id/synctex', async (request, reply) => {
  await getProject(request.params.id)
  const directory = projectDir(request.params.id)
  const file = path.join(directory, '.openleaf', 'output.synctex.gz')
  if (!existsSync(file)) fail(404, '当前 PDF 没有定位数据，请重新编译')
  const compressed = await readFile(file)
  if (compressed.length > 12 * 1024 * 1024) fail(413, '定位数据过大')
  const source = gunzipSync(compressed, { maxOutputLength: 80 * 1024 * 1024 }).toString('utf8')
  return reply.header('Cache-Control', 'no-store').send({ points: parseSynctex(source, directory) })
})

app.post('/api/import', async request => {
  const upload = await request.file()
  if (!upload) fail(400, '请选择 ZIP 文件')
  const bytes = await upload.toBuffer()
  let zip: AdmZip
  try { zip = new AdmZip(bytes) } catch { fail(400, '无效的 ZIP 文件') }
  const entries = zip.getEntries()
  if (entries.length > 1000 || entries.reduce((sum, entry) => sum + entry.header.size, 0) > 100 * 1024 * 1024) fail(413, '项目压缩包过大')
  const name = path.basename(upload.filename, path.extname(upload.filename)).slice(0, 80) || '导入项目'
  const project = await createProject(name)
  try {
    await rm(path.join(projectDir(project.id), 'main.tex'), { force: true })
    const files: string[] = []
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const relative = safeRelative(entry.entryName)
      const target = await safeFile(project.id, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, entry.getData())
      files.push(relative)
    }
    project.mainFile = files.includes('main.tex') ? 'main.tex' : files.find(f => f.endsWith('.tex')) || ''
    if (!project.mainFile) fail(400, 'ZIP 中没有 .tex 文件')
    await saveProject(project)
    return project
  } catch (error) {
    await rm(projectDir(project.id), { recursive: true, force: true })
    throw error
  }
})
app.get<{ Params: { id: string } }>('/api/projects/:id/export', async (request, reply) => {
  const project = await getProject(request.params.id)
  const zip = new AdmZip()
  for (const entry of await listProjectFiles(project.id)) {
    if (entry.type === 'file') zip.addLocalFile(await safeFile(project.id, entry.path), path.posix.dirname(entry.path) === '.' ? '' : path.posix.dirname(entry.path))
  }
  return reply.header('Content-Disposition', `attachment; filename="${project.id}.zip"`).type('application/zip').send(zip.toBuffer())
})

const dist = path.join(root, 'dist')
if (existsSync(dist)) await app.register(fastifyStatic, { root: dist, prefix: '/' })
const port = Number(process.env.PORT || 3001)
await app.listen({ host: '127.0.0.1', port })
console.log(`TeXloom API: http://127.0.0.1:${port}`)
export { app }
