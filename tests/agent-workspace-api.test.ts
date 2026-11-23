import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { AgentResolution } from '../shared/agent-review.js'
import { agentReviewVersion } from '../shared/agent-review.js'
import { automaticSnapshotLimit, type Snapshot } from '../shared/snapshots.js'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

test('Agent API 在草稿中续接，对照后才写回原项目', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texloom-agent-api-'))
  const id = randomUUID()
  const projectRoot = path.join(root, 'projects')
  const project = path.join(projectRoot, id)
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const projectPath = path.resolve('server', '..')
  let service: ReturnType<typeof spawn> | undefined
  try {
    await mkdir(project, { recursive: true })
    await writeFile(path.join(project, 'project.json'), JSON.stringify({ id, name: '测试项目', mainFile: 'main.tex', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
    await writeFile(path.join(project, 'main.tex'), '原文\n')
    const config = path.join(root, 'workspace.json')
    await writeFile(config, JSON.stringify({ activeRoot: projectRoot, roots: [projectRoot], configured: true }))
    await writeFile(path.join(root, 'doubao.cmd'), '@echo off\r\nif "%1"=="--version" (echo doubao-test & exit /b 0)\r\nif "%1"=="-p" (echo agent draft>main.tex & echo draft-ready & exit /b 0)\r\nexit /b 1\r\n')
    service = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: projectPath, windowsHide: true, env: { ...process.env, PORT: String(port), TEXLOOM_TEST_WORKSPACE_CONFIG: config, PATH: `${root};${process.env.PATH || ''}` }, stdio: 'ignore' })
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await fetch(`${baseUrl}/api/health`).then(response => response.ok).catch(() => false)) { ready = true; break }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    assert.equal(ready, true, '测试 API 未启动')
    const headers = { 'X-TeXloom-Agent': '1', 'Content-Type': 'application/json' }
    const request = () => fetch(`${baseUrl}/api/projects/${id}/agent/run`, { method: 'POST', headers, body: JSON.stringify({ provider: 'doubao', profileId: 'doubao-default', mode: 'edit', prompt: '修改项目文件', files: [] }) })
    const first = await request()
    assert.equal(first.status, 200)
    assert.match(await first.text(), /"type":"complete"/)
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), '原文\n')
    await writeFile(path.resolve('data', 'agent-workspaces', id, 'work', 'main.tex'), '中断后留下的草稿\n')
    const recovered = await fetch(`${baseUrl}/api/projects/${id}/agent/session`, { headers }).then(response => response.json()) as { pending: { after: string }[] }
    assert.equal(recovered.pending[0].after, '中断后留下的草稿\n')
    const second = await request()
    assert.equal(second.status, 200)
    assert.match(await second.text(), /"type":"complete"/)
    const review = await fetch(`${baseUrl}/api/projects/${id}/agent/review`, { headers }).then(response => response.json()) as { changes: { path: string; kind: string; after: string }[] }
    assert.deepEqual(review.changes.map(item => [item.path, item.kind]), [['main.tex', 'modified']])
    assert.match(review.changes[0].after, /agent draft/)
    await writeFile(path.join(project, 'main.tex'), '用户同时编辑\n')
    const loadConflict = async () => {
      const result = await fetch(`${baseUrl}/api/projects/${id}/agent/review`, { headers }).then(response => response.json()) as {
        agentReviewVersion?: number
        changes: { conflict: boolean; current: string; currentHash: string | null; beforeHash?: string; afterHash?: string }[]
      }
      assert.equal(result.agentReviewVersion, agentReviewVersion)
      assert.equal(result.changes[0].conflict, true)
      return result.changes[0]
    }
    const applyVersion = (resolution?: AgentResolution) => fetch(`${baseUrl}/api/projects/${id}/agent/apply`, {
      method: 'POST', headers,
      body: JSON.stringify({ paths: ['main.tex'], ...(resolution ? { resolutions: { 'main.tex': resolution } } : {}) }),
    })
    const resolutionFor = (choice: AgentResolution['choice'], change: Awaited<ReturnType<typeof loadConflict>>): AgentResolution => ({
      choice, currentHash: change.currentHash, beforeHash: change.beforeHash ?? null, afterHash: change.afterHash ?? null,
    })
    const conflicted = await loadConflict()
    assert.equal(conflicted.current, '用户同时编辑\n')
    const rejected = await applyVersion()
    assert.equal(rejected.status, 409)
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), '用户同时编辑\n')
    await writeFile(path.join(project, 'main.tex'), '用户再次编辑\n')
    const stale = await applyVersion(resolutionFor('draft', conflicted))
    assert.equal(stale.status, 409)
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), '用户再次编辑\n')
    const stalePreview = await fetch(`${baseUrl}/api/projects/${id}/agent/preview?path=main.tex&side=current&hash=${conflicted.currentHash}`, { headers })
    assert.equal(stalePreview.status, 409)
    const applied = await applyVersion(resolutionFor('draft', await loadConflict()))
    const appliedResult = await applied.json()
    assert.equal(applied.status, 200, JSON.stringify(appliedResult))
    assert.deepEqual(appliedResult, { applied: ['main.tex'], kept: [], resolved: ['main.tex'], remaining: 0 })
    assert.match(await readFile(path.join(project, 'main.tex'), 'utf8'), /agent draft/)
    await writeFile(path.join(project, 'main.tex'), '新基线\n')
    const third = await request()
    assert.equal(third.status, 200)
    assert.match(await third.text(), /"type":"complete"/)
    await writeFile(path.join(project, 'main.tex'), '应保留此版本\n')
    const kept = await applyVersion(resolutionFor('current', await loadConflict()))
    const keptResult = await kept.json()
    assert.equal(kept.status, 200, JSON.stringify(keptResult))
    assert.deepEqual(keptResult, { applied: [], kept: ['main.tex'], resolved: ['main.tex'], remaining: 0 })
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), '应保留此版本\n')

    const historyUrl = baseUrl + '/api/projects/' + id + '/history'
    const historyDir = path.join(project, '.openleaf', 'history')
    const history = async (): Promise<Snapshot[]> => {
      const response = await fetch(historyUrl)
      assert.equal(response.status, 200)
      return response.json()
    }
    const initialBackups = await history()
    assert.equal(initialBackups.length, 1)
    assert.equal(initialBackups[0].kind, 'automatic')
    const legacy = Array.from({ length: 5 }, (_, index) => ({
      ...initialBackups[0], id: randomUUID(), kind: undefined,
      note: index === 2 ? '恢复前备份：原版本' : 'Agent 修改应用前',
    }))
    const legacyManual = { ...legacy[0], id: randomUUID(), note: '旧手动快照' }
    for (const item of [...legacy, legacyManual]) await writeFile(path.join(historyDir, item.id + '.zip'), '')
    await writeFile(path.join(historyDir, 'index.json'), JSON.stringify([...initialBackups, ...legacy, legacyManual]))
    const migrated = await history()
    assert.deepEqual(migrated.filter(item => item.kind === 'automatic').map(item => item.id), [initialBackups[0], ...legacy].slice(0, 4).map(item => item.id))
    assert.deepEqual(migrated.filter(item => item.kind === 'manual').map(item => item.id), [legacyManual.id])
    for (const item of legacy.slice(3)) await assert.rejects(readFile(path.join(historyDir, item.id + '.zip')), { code: 'ENOENT' })

    const manual = await Promise.all(Array.from({ length: 6 }, (_, index) => fetch(historyUrl, {
      method: 'POST', headers, body: JSON.stringify({ note: index === 0 ? 'Agent 修改应用前' : '手动 ' + index }),
    }).then(async response => {
      assert.equal(response.status, 200)
      return await response.json() as Snapshot
    })))
    assert.ok(manual.every(item => item.kind === 'manual'))
    assert.equal((await history()).filter(item => item.kind === 'manual').length, 7)

    const restore = (id: string) => fetch(historyUrl + '/' + id + '/restore', { method: 'POST' })
    for (let index = 0; index < automaticSnapshotLimit; index++) {
      await writeFile(path.join(project, 'main.tex'), '自动备份 ' + index)
      const restored = await restore(manual[0].id)
      assert.equal(restored.status, 200, await restored.text())
    }
    const oldest = (await history()).filter(item => item.kind === 'automatic').at(-1)!
    const restored = await restore(oldest.id)
    assert.equal(restored.status, 200, await restored.text())
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), '自动备份 0')
    await assert.rejects(readFile(path.join(historyDir, oldest.id + '.zip')), { code: 'ENOENT' })

    const removed = await fetch(historyUrl + '/' + manual[0].id, { method: 'DELETE' })
    assert.equal(removed.status, 200, await removed.text())
    assert.equal((await restore(manual[0].id)).status, 404)
    const retained = await history()
    assert.equal(retained.filter(item => item.kind === 'automatic').length, automaticSnapshotLimit)
    assert.equal(retained.filter(item => item.kind === 'manual').length, 6)
    assert.deepEqual((await readdir(historyDir)).filter(name => name.endsWith('.zip')).sort(), retained.map(item => item.id + '.zip').sort())
  } finally {
    if (service && service.exitCode === null && service.signalCode === null) { service.kill(); await new Promise(resolve => service!.once('close', resolve)) }
    const workspaceRoot = path.resolve('data', 'agent-workspaces')
    const workspace = path.resolve(workspaceRoot, id)
    assert.equal(path.relative(workspaceRoot, workspace), id)
    await rm(workspace, { recursive: true, force: true })
    await rm(path.resolve('data', 'agent-sessions', `${id}.json`), { force: true })
    assert.equal(path.relative(os.tmpdir(), root).startsWith('..'), false)
    await rm(root, { recursive: true, force: true })
  }
})
