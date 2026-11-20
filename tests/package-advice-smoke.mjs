import assert from 'node:assert/strict'

const base = process.env.TEXLOOM_URL || 'http://127.0.0.1:3002'
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`)
  return data
}

const project = await request('/api/projects', 'POST', { name: `TeXloom package check ${Date.now()}` })
const prefix = `/api/projects/${project.id}`
try {
  const source = '\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n'
  await request(`${prefix}/file?path=main.tex`, 'PUT', { content: source })
  const advice = await request(`${prefix}/package-advice?goal=${encodeURIComponent('多行公式')}`)
  assert.ok(advice.suggestions.some(item => item.key === 'amsmath' && !item.installed))
  const preview = await request(`${prefix}/package-preview?key=amsmath`)
  assert.equal(preview.insertion, '\\usepackage{amsmath}\n')
  await request(`${prefix}/file?path=main.tex`, 'PUT', { content: `${source}\n` })
  await request(`${prefix}/package-apply`, 'POST', { key: 'amsmath', expectedHash: preview.sourceHash }, 409)
  const latest = await request(`${prefix}/package-preview?key=amsmath`)
  const applied = await request(`${prefix}/package-apply`, 'POST', { key: 'amsmath', expectedHash: latest.sourceHash })
  assert.ok(applied.content.includes('\\usepackage{amsmath}\n\\begin{document}'))
  assert.equal((await request(`${prefix}/file?path=main.tex`)).content, applied.content)
  await request(`${prefix}/package-preview?key=amsmath`, 'GET', undefined, 400)
  const started = await request(`${prefix}/compile`, 'POST')
  let job = started
  for (let attempt = 0; attempt < 120 && job.status === 'running'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    job = await request(`${prefix}/jobs/${started.id}`)
  }
  assert.equal(job.status, 'success', `Tectonic compile: ${job.log.slice(-1200)}`)
  console.log('package advice, stale preview protection, apply, duplicate and Tectonic compile checks passed')
} finally {
  await request(prefix, 'DELETE')
}
