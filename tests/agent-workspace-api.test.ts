import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

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
    const conflicted = await fetch(`${baseUrl}/api/projects/${id}/agent/review`, { headers }).then(response => response.json()) as { changes: { conflict: boolean; current: string }[] }
    assert.equal(conflicted.changes[0].conflict, true)
    assert.equal(conflicted.changes[0].current, '用户同时编辑\n')
    const rejected = await fetch(`${baseUrl}/api/projects/${id}/agent/apply`, { method: 'POST', headers, body: JSON.stringify({ paths: ['main.tex'] }) })
    assert.equal(rejected.status, 409)
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), '用户同时编辑\n')
    await writeFile(path.join(project, 'main.tex'), '原文\n')
    const applied = await fetch(`${baseUrl}/api/projects/${id}/agent/apply`, { method: 'POST', headers, body: JSON.stringify({ paths: ['main.tex'] }) })
    assert.equal(applied.status, 200, await applied.text())
    assert.match(await readFile(path.join(project, 'main.tex'), 'utf8'), /agent draft/)
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
