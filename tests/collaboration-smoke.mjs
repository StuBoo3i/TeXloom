import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const base = process.env.TEXLOOM_URL || 'http://127.0.0.1:3002'
const workspace = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(os.tmpdir(), 'texloom-collab-smoke-'))
const ids = []
function git(cwd, ...args) {
  const child = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (child.status !== 0) throw new Error(`git ${args.join(' ')}: ${child.stderr || child.stdout}`)
  return child.stdout.trim()
}
async function api(route, options) {
  const response = await fetch(`${base}${route}`, options)
  const data = await response.json()
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(data)}`)
  return data
}
const post = body => ({ method: 'POST', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
try {
  git(temp, 'init', '--bare', 'remote.git')
  const remote = path.join(temp, 'remote.git')
  const legacy = await api('/api/projects', post({ name: '旧元数据迁移测试' }))
  ids.push(legacy.id)
  const legacyDir = path.join(workspace, 'projects', legacy.id)
  git(legacyDir, 'init')
  git(legacyDir, 'add', 'project.json', 'main.tex')
  git(legacyDir, '-c', 'user.name=Legacy', '-c', 'user.email=legacy@example.test', 'commit', '-m', 'Legacy metadata')
  await api(`/api/projects/${legacy.id}/git/init`, post())
  assert.equal(git(legacyDir, 'ls-files', '--', 'project.json'), '')
  assert.equal(JSON.parse(await readFile(path.join(legacyDir, 'project.json'), 'utf8')).id, legacy.id)
  const first = await api('/api/projects', post({ name: '协作测试 A' }))
  const second = await api('/api/projects', post({ name: '协作测试 B' }))
  ids.push(first.id, second.id)
  const a = path.join(workspace, 'projects', first.id)
  const b = path.join(workspace, 'projects', second.id)
  await api(`/api/projects/${first.id}/git/init`, post())
  await api(`/api/projects/${first.id}/git/commit`, post({ message: 'Initial source', name: 'Alice', email: 'alice@example.test' }))
  git(a, 'branch', '-M', 'main')
  git(a, 'remote', 'add', 'origin', remote)
  git(a, 'push', '-u', 'origin', 'main')
  await api(`/api/projects/${second.id}/git/init`, post())
  git(b, 'remote', 'add', 'origin', remote)
  git(b, 'fetch', 'origin')
  await rm(path.join(b, 'main.tex'))
  await rm(path.join(b, '.gitignore'))
  git(b, 'switch', '-C', 'main', '--track', 'origin/main')

  const initialBranches = await api(`/api/projects/${second.id}/git/branches`)
  assert.ok(initialBranches.remote.includes('main'))
  const initialView = await api(`/api/projects/${second.id}/git/branch-view?branch=main&path=main.tex`)
  assert.ok(initialView.content.includes('\\documentclass'))
  await api(`/api/projects/${second.id}/git/branch`, post({ name: 'feature/bob', from: 'main' }))
  await api(`/api/projects/${second.id}/file?path=main.tex`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `${initialView.content}\n% Bob edit\n` }) })
  await api(`/api/projects/${second.id}/git/commit`, post({ message: 'Bob source edit', name: 'Bob', email: 'bob@example.test' }))
  await api(`/api/projects/${second.id}/git/sync`, post({ action: 'push' }))
  await api(`/api/projects/${first.id}/git/fetch`, post())
  const branchView = await api(`/api/projects/${first.id}/git/branch-view?branch=feature%2Fbob&path=main.tex`)
  assert.ok(branchView.content.includes('% Bob edit'))
  const diffView = await api(`/api/projects/${first.id}/git/branch-view?branch=feature%2Fbob&path=main.tex&diff=1`)
  assert.ok(diffView.diff.includes('Bob edit'))
  await api(`/api/projects/${first.id}/review/author`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Alice' }) })
  await api(`/api/projects/${second.id}/review/author`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bob' }) })

  const thread = await api(`/api/projects/${first.id}/review`, post({ file: 'main.tex', line: 1, column: 1, offset: 0, original: '', body: 'Alice comment', type: 'comment' }))
  assert.equal(thread.author, 'Alice')
  const firstSync = await api(`/api/projects/${first.id}/git/review-sync`, post())
  assert.equal(firstSync.pending, 0)
  await api(`/api/projects/${second.id}/git/review-sync`, post())
  assert.ok((await api(`/api/projects/${second.id}/review`)).some(item => item.id === thread.id))
  await api(`/api/projects/${second.id}/review/${thread.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reply', body: 'Bob reply' }) })
  await api(`/api/projects/${second.id}/git/review-sync`, post())
  await api(`/api/projects/${first.id}/git/review-sync`, post())
  const updated = (await api(`/api/projects/${first.id}/review`)).find(item => item.id === thread.id)
  assert.equal(updated.replies.length, 1)
  assert.equal(updated.replies[0].body, 'Bob reply')
  assert.equal(updated.replies[0].author, 'Bob')

  await api(`/api/projects/${first.id}/review`, post({ file: 'main.tex', line: 1, column: 1, offset: 0, original: '', body: 'Alice concurrent', type: 'comment' }))
  const bobThread = await api(`/api/projects/${second.id}/review`, post({ file: 'main.tex', line: 1, column: 1, offset: 0, original: '', body: 'Bob concurrent', type: 'comment' }))
  await api(`/api/projects/${first.id}/git/review-sync`, post())
  await api(`/api/projects/${second.id}/git/review-sync`, post())
  await api(`/api/projects/${first.id}/git/review-sync`, post())
  const threads = await api(`/api/projects/${first.id}/review`)
  assert.equal(threads.length, 3)
  assert.equal(new Set(threads.map(item => item.id)).size, 3)
  assert.equal(threads.find(item => item.id === bobThread.id).locationStale, true)
  console.log(JSON.stringify({ firstSync, threads: threads.length, replies: updated.replies.length, remoteBranches: git(temp, '--git-dir', remote, 'branch', '--list') }))
} finally {
  for (const id of ids) await fetch(`${base}/api/projects/${id}`, { method: 'DELETE' })
  if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('texloom-collab-smoke-')) throw new Error('临时测试目录路径校验失败')
  await rm(temp, { recursive: true, force: true })
}
