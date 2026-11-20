import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.TEXLOOM_URL || process.env.OPENLEAF_URL || 'http://127.0.0.1:3002'
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${method} ${path}: ${data.error || response.status}`)
  return data
}

const project = await request('/api/projects', 'POST', { name: `TeXloom smoke ${Date.now()}` })
const imageProject = await request('/api/projects', 'POST', { name: `TeXloom image smoke ${Date.now()}` })
const prefix = `/api/projects/${project.id}`
try {
  const source = (await request(`${prefix}/file?path=main.tex`)).content
  const original = '在这里编写'
  const offset = source.indexOf(original)
  assert.ok(offset >= 0)
  const before = source.slice(0, offset)
  const review = await request(`${prefix}/review`, 'POST', { file: 'main.tex', line: before.split('\n').length, column: before.split('\n').at(-1).length + 1, offset, original, body: '测试修改建议', proposed: '在这里完成', type: 'suggestion' })
  await request(`${prefix}/review/${review.id}`, 'PATCH', { action: 'accept' })
  const accepted = (await request(`${prefix}/file?path=main.tex`)).content
  assert.ok(accepted.includes('在这里完成'))
  assert.equal((await request(`${prefix}/review`))[0].status, 'accepted')

  const form = new FormData()
  form.append('file', new Blob([await readFile(new URL('../runtime/preview-1.png', import.meta.url))], { type: 'image/png' }), 'figure.png')
  const upload = await fetch(`${base}/api/projects/${imageProject.id}/upload?path=images%2Ffigure.png`, { method: 'POST', body: form })
  assert.equal(upload.status, 200)
  const copied = await request(`${prefix}/copy-image`, 'POST', { sourceProjectId: imageProject.id, sourcePath: 'images/figure.png' })
  assert.ok((await request(`${prefix}/files`)).some(file => file.path === copied.path))
  const invalidUrl = await fetch(`${base}${prefix}/import-image-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1/private.png' }) })
  assert.equal(invalidUrl.status, 400)

  const snapshot = await request(`${prefix}/history`, 'POST', { note: '验收快照' })
  await request(`${prefix}/file?path=main.tex`, 'PUT', { content: 'temporary change' })
  await request(`${prefix}/history/${snapshot.id}/restore`, 'POST')
  assert.equal((await request(`${prefix}/file?path=main.tex`)).content, accepted)
  assert.ok((await request(`${prefix}/history`)).length >= 2)

  await request(`${prefix}/git/init`, 'POST')
  await request(`${prefix}/git/commit`, 'POST', { message: 'Initial project', name: 'TeXloom Test', email: 'texloom-test@localhost' })
  const git = await request(`${prefix}/git`)
  assert.equal(git.initialized, true)
  assert.equal(git.commits.length, 1)
  console.log('review, snapshot restore, and Git smoke checks passed')
} finally {
  await request(prefix, 'DELETE')
  await request(`/api/projects/${imageProject.id}`, 'DELETE')
}
