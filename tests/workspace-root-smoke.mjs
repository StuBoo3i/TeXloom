import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temporary = await mkdtemp(path.join(os.tmpdir(), 'texloom-workspace-'))
const custom = path.join(temporary, 'custom')
const nested = path.join(custom, 'nested')
const config = path.join(temporary, 'settings', 'workspace.json')
const base = 'http://127.0.0.1:3003'
let server
let projectId
const createdIds = []

async function request(route, method = 'GET', body, expected = 200) {
  const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  assert.equal(response.status, expected, `${method} ${route}: ${data.error || response.status}`)
  return data
}

async function start() {
  server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: '3003', TEXLOOM_TEST_FOLDER_PICKER: '1', TEXLOOM_TEST_WORKSPACE_CONFIG: config },
    stdio: 'ignore', windowsHide: true,
  })
  for (let index = 0; index < 60; index++) {
    if (server.exitCode !== null) throw new Error(`Test server exited with ${server.exitCode}`)
    try { if ((await request('/api/health')).ok) return } catch { /* wait */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Test server did not start')
}

async function stop() {
  if (!server) return
  const process = server
  server = undefined
  if (process.exitCode !== null) return
  process.kill()
  await new Promise(resolve => process.once('exit', resolve))
}

try {
  await mkdir(nested, { recursive: true })
  const canonicalCustom = await realpath(custom)
  await start()
  const initial = await request('/api/workspace')
  assert.equal(initial.configured, false)
  assert.ok(existsSync(initial.defaultRoot))
  const sourceSelection = await request('/api/workspace/select', 'POST', { testPath: path.dirname(initial.defaultRoot) })
  await request('/api/workspace/root', 'POST', { choice: 'selected', token: sourceSelection.token }, 400)
  const existing = await request('/api/projects')
  const selection = await request('/api/workspace/select', 'POST', { testPath: custom })
  assert.ok(selection.token)
  const configured = await request('/api/workspace/root', 'POST', { choice: 'selected', token: selection.token })
  assert.equal(configured.root, canonicalCustom)
  const created = await request('/api/projects', 'POST', { name: `Workspace test ${Date.now()}` })
  projectId = created.id
  createdIds.push(projectId)
  assert.equal((await request(`/api/workspace?projectId=${projectId}`)).projectRoot, canonicalCustom)
  assert.equal((await request(`/api/workspace?projectId=${projectId}`)).projectPath, path.join(canonicalCustom, projectId))
  assert.ok(existsSync(path.join(custom, projectId, 'main.tex')))
  const source = path.join(temporary, 'source')
  await mkdir(source)
  await writeFile(path.join(source, 'main.tex'), '\\documentclass{article}\n\\begin{document}Imported\\end{document}\n')
  const folder = await request('/api/folders/select', 'POST', { mode: 'import', testPath: source })
  const imported = await request('/api/folders/import', 'POST', { token: folder.token })
  assert.equal(imported.failed.length, 0)
  assert.equal(imported.imported.length, 1)
  createdIds.push(imported.imported[0].id)
  assert.equal((await request(`/api/workspace?projectId=${imported.imported[0].id}`)).projectRoot, canonicalCustom)
  if (existing.length) {
    const old = existing[0]
    assert.equal((await request(`/api/projects/${old.id}`)).id, old.id)
    assert.equal((await request(`/api/workspace?projectId=${old.id}`)).projectRoot, initial.defaultRoot)
  }
  const nestedSelection = await request('/api/workspace/select', 'POST', { testPath: nested })
  await request('/api/workspace/root', 'POST', { choice: 'selected', token: nestedSelection.token }, 400)
  const collision = path.join(temporary, 'collision')
  await mkdir(path.join(collision, projectId), { recursive: true })
  await writeFile(path.join(collision, projectId, 'project.json'), '{}')
  const collisionSelection = await request('/api/workspace/select', 'POST', { testPath: collision })
  await request('/api/workspace/root', 'POST', { choice: 'selected', token: collisionSelection.token }, 409)
  const restored = await request('/api/workspace/root', 'POST', { choice: 'default' })
  assert.equal(restored.root, initial.defaultRoot)
  assert.equal((await request(`/api/workspace?projectId=${projectId}`)).projectRoot, canonicalCustom)
  await stop()
  await start()
  assert.equal((await request('/api/workspace')).root, initial.defaultRoot)
  assert.equal((await request('/api/workspace')).configured, true)
  assert.equal((await request(`/api/projects/${projectId}`)).id, projectId)
  assert.equal((await request(`/api/workspace?projectId=${projectId}`)).projectRoot, canonicalCustom)
  console.log('workspace root selection, existing projects, persistence and overlap checks passed')
} finally {
  if (server) for (const id of createdIds) await request(`/api/projects/${id}`, 'DELETE').catch(() => {})
  await stop()
  const absolute = path.resolve(temporary)
  if (absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(absolute).startsWith('texloom-workspace-')) await rm(absolute, { recursive: true, force: true })
}
