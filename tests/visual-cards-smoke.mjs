import assert from 'node:assert/strict'

const base = process.env.TEXLOOM_URL || 'http://127.0.0.1:3001'
async function request(route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${method} ${route}: ${data.error || response.status}`)
  return data
}

const project = await request('/api/projects', 'POST', { name: `Visual card smoke ${Date.now()}` })
const prefix = `/api/projects/${project.id}`
const source = '\\documentclass{article}\n\\begin{document}\n\\begin{table}[htbp]\n\\centering\n\\begin{tabular}{cc}A & B \\\\ 1 & 2\\end{tabular}\n\\caption{Results}\\label{tab:results}\n\\end{table}\n\\end{document}\n'
try {
  await request(`${prefix}/file?path=main.tex`, 'PUT', { content: source })
  const start = source.indexOf('\\begin{table}')
  const end = source.indexOf('\\end{table}') + '\\end{table}'.length
  const preview = await request(`${prefix}/card-preview`, 'POST', { file: 'main.tex', start, end, expected: source.slice(start, end) })
  assert.equal((await fetch(`${base}${preview.url}`)).status, 200)
  const draft = await request(`${prefix}/compile`, 'POST', { mode: 'draft', includeCards: [] })
  let result = draft
  for (let i = 0; i < 60 && result.status === 'running'; i++) { await new Promise(resolve => setTimeout(resolve, 500)); result = await request(`${prefix}/jobs/${draft.id}`) }
  assert.equal(result.status, 'success', result.log)
  assert.equal((await fetch(`${base}${prefix}/pdf?mode=draft`)).status, 200)
  const draftMap = await request(`${prefix}/synctex?mode=draft`)
  assert.ok(draftMap.points.every(point => point.file === 'main.tex'))
  const full = await request(`${prefix}/compile`, 'POST', { mode: 'full' })
  result = full
  for (let i = 0; i < 60 && result.status === 'running'; i++) { await new Promise(resolve => setTimeout(resolve, 500)); result = await request(`${prefix}/jobs/${full.id}`) }
  assert.equal(result.status, 'success', result.log)
  assert.equal((await fetch(`${base}${prefix}/pdf?mode=full`)).status, 200)
  assert.equal((await fetch(`${base}${prefix}/pdf?mode=draft`)).status, 200)
  assert.equal((await request(`${prefix}/file?path=main.tex`)).content, source)
  console.log('Visual card preview, draft/full compilation, SyncTeX and source preservation passed')
} finally {
  await request(prefix, 'DELETE')
}
