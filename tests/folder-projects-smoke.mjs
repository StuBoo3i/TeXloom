import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const base = process.env.TEXLOOM_URL || 'http://127.0.0.1:3002'
const temporary = await mkdtemp(path.join(os.tmpdir(), 'texloom-folders-'))
const created = []
const tag = `folder-smoke-${Date.now()}`

async function request(route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${method} ${route}: ${data.error || response.status}`)
  return data
}

async function select(mode, testPath) {
  const choice = await request('/api/folders/select', 'POST', { mode, testPath })
  assert.ok(choice.token, 'test server must set TEXLOOM_TEST_FOLDER_PICKER=1')
  return choice.token
}

try {
  const source = path.join(temporary, 'source')
  const destination = path.join(temporary, 'destination')
  await mkdir(path.join(source, 'One', '.git'), { recursive: true })
  await mkdir(path.join(source, 'Two', 'chapters'), { recursive: true })
  await mkdir(destination)
  await writeFile(path.join(source, 'One', 'main.tex'), '\\documentclass{article}\n\\begin{document}One\\end{document}\n')
  await writeFile(path.join(source, 'One', '.env'), 'SECRET_SHOULD_NOT_IMPORT')
  await writeFile(path.join(source, 'One', '.git', 'config'), 'SECRET_GIT_CONFIG')
  await writeFile(path.join(source, 'Two', 'chapters', 'paper.tex'), '\\documentclass{article}\n\\begin{document}Two\\end{document}\n')

  await request('/api/project-tags', 'POST', { name: tag })
  const importToken = await select('import', source)
  const preview = await request('/api/folders/inspect', 'POST', { token: importToken })
  assert.equal(preview.candidates.length, 2)
  const firstImport = await request('/api/folders/import', 'POST', { token: importToken })
  assert.equal(firstImport.failed.length, 0)
  assert.equal(firstImport.imported.length, 2)
  created.push(...firstImport.imported.map(item => item.id))
  const one = firstImport.imported.find(item => item.name === 'One')
  assert.ok(one)
  assert.ok(!(await request(`/api/projects/${one.id}/files`)).some(item => item.path === '.env' || item.path.startsWith('.git')))
  await request(`/api/projects/${one.id}`, 'PATCH', { sharing: 'shared', archived: true, tags: [tag] })
  const listed = await request('/api/projects')
  assert.equal(listed.find(item => item.id === one.id).sharing, 'shared')
  assert.equal(listed.find(item => item.id === one.id).archived, true)
  assert.deepEqual(listed.find(item => item.id === one.id).tags, [tag])

  const sentinel = path.join(destination, 'One', 'sentinel.txt')
  await mkdir(path.dirname(sentinel))
  await writeFile(sentinel, 'keep')
  const exportToken = await select('export', destination)
  const result = await request('/api/folders/export', 'POST', { token: exportToken, projectIds: firstImport.imported.map(item => item.id) })
  assert.equal(result.failed.length, 0)
  assert.equal(result.exported.length, 2)
  assert.equal(await readFile(sentinel, 'utf8'), 'keep')
  const exportedOne = result.exported.find(item => item.id === one.id)
  assert.equal(exportedOne.folder, 'One (2)')
  assert.deepEqual(JSON.parse(await readFile(path.join(destination, exportedOne.folder, '.texloom-project.json'), 'utf8')).tags, [tag])

  const reimportToken = await select('import', path.join(destination, exportedOne.folder))
  const reimport = await request('/api/folders/import', 'POST', { token: reimportToken })
  assert.equal(reimport.failed.length, 0)
  assert.equal(reimport.imported.length, 1)
  created.push(reimport.imported[0].id)
  assert.equal(reimport.imported[0].sharing, 'shared')
  assert.equal(reimport.imported[0].archived, true)
  assert.deepEqual(reimport.imported[0].tags, [tag])
  assert.ok((await readdir(destination)).includes('One (2)'))
  console.log('folder import/export, category, tags, metadata and no-overwrite checks passed')
} finally {
  for (const id of created) await request(`/api/projects/${id}`, 'DELETE').catch(() => {})
  await request(`/api/project-tags/${encodeURIComponent(tag)}`, 'DELETE').catch(() => {})
  const absolute = path.resolve(temporary)
  if (absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(absolute).startsWith('texloom-folders-')) await rm(absolute, { recursive: true, force: true })
}
