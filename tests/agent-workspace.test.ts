import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applyAgentChanges, collectAgentChanges, createAgentWorkspace, workspaceFile, workspacePaths } from '../server/agent-workspace.js'
import { applyLineHunks, lineHunks } from '../shared/agent-hunks.js'

test('文本差异可按独立片段采纳，保留未采纳片段', () => {
  const before = '第一行\n保留\n第二行\n保留二\n第三行\n'
  const after = '第一行修改\n保留\n第二行修改\n保留二\n第三行\n'
  const hunks = lineHunks(before, after)
  assert.equal(hunks?.length, 2)
  assert.equal(applyLineHunks(before, hunks!, new Set([0])), '第一行修改\n保留\n第二行\n保留二\n第三行\n')
})

test('共享工作副本保留草稿，并比较修改、新建和删除的文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texloom-agent-work-'))
  try {
    const project = path.join(root, 'project')
    const container = path.join(root, 'draft')
    await mkdir(path.join(project, 'figures'), { recursive: true })
    await writeFile(path.join(project, 'main.tex'), 'old\n')
    await writeFile(path.join(project, 'figures', 'old.png'), Buffer.from([0, 1, 2]))
    await createAgentWorkspace(container, project, [{ path: 'main.tex', size: 4 }, { path: 'figures/old.png', size: 3 }])
    const { base, work } = workspacePaths(container)
    assert.equal(await realpath(execFileSync('git', ['-C', work, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()), await realpath(work))
    assert.equal(execFileSync('git', ['-C', work, 'remote'], { encoding: 'utf8' }).trim(), '')
    await writeFile(path.join(work, 'main.tex'), 'new\n')
    await writeFile(path.join(work, 'figures', 'new.png'), Buffer.from([0, 3, 4]))
    await rm(path.join(work, 'figures', 'old.png'))
    const changes = await collectAgentChanges(base, work)
    assert.deepEqual(changes.map(item => [item.path, item.kind, item.binary]), [
      ['figures/new.png', 'created', true], ['figures/old.png', 'deleted', true], ['main.tex', 'modified', false],
    ])
    assert.equal(changes.find(item => item.path === 'main.tex')?.before, 'old\n')
    await assert.rejects(applyAgentChanges(changes.filter(item => item.path === 'main.tex'), base, work, async relative => workspaceFile(project, relative), async () => { await writeFile(path.join(project, 'main.tex'), 'concurrent\n') }), /./)
  } finally { assert.equal(path.relative(os.tmpdir(), root).startsWith('..'), false); await rm(root, { recursive: true, force: true }) }
})

test('采纳前检查源文件冲突，按文件应用后保留其余草稿', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texloom-agent-apply-'))
  try {
    const project = path.join(root, 'project')
    const container = path.join(root, 'draft')
    await mkdir(project)
    await writeFile(path.join(project, 'main.tex'), 'base')
    await createAgentWorkspace(container, project, [{ path: 'main.tex', size: 4 }])
    const { base, work } = workspacePaths(container)
    await writeFile(path.join(work, 'main.tex'), 'agent')
    await writeFile(path.join(work, 'new.bib'), '@book{key}')
    const changes = await collectAgentChanges(base, work)
    await writeFile(path.join(project, 'main.tex'), 'user')
    await assert.rejects(applyAgentChanges(changes, base, work, async relative => workspaceFile(project, relative)), /需先核对冲突/)
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), 'user')
    await writeFile(path.join(project, 'main.tex'), 'base')
    const applied = await applyAgentChanges(changes.filter(item => item.path === 'main.tex'), base, work, async relative => workspaceFile(project, relative))
    assert.deepEqual(applied, ['main.tex'])
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), 'agent')
    assert.deepEqual((await collectAgentChanges(base, work)).map(item => item.path), ['new.bib'])
  } finally { assert.equal(path.relative(os.tmpdir(), root).startsWith('..'), false); await rm(root, { recursive: true, force: true }) }
})

test('按段采纳后，剩余片段仍留在同一份草稿中', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texloom-agent-hunks-'))
  try {
    const project = path.join(root, 'project')
    const container = path.join(root, 'draft')
    await mkdir(project)
    await writeFile(path.join(project, 'main.tex'), 'a\nkeep\nb\n')
    await createAgentWorkspace(container, project, [{ path: 'main.tex', size: 9 }])
    const { base, work } = workspacePaths(container)
    await writeFile(path.join(work, 'main.tex'), 'A\nkeep\nB\n')
    const changes = await collectAgentChanges(base, work)
    await applyAgentChanges(changes, base, work, async relative => workspaceFile(project, relative), undefined, { 'main.tex': [0] })
    assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), 'A\nkeep\nb\n')
    const remaining = await collectAgentChanges(base, work)
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].before, 'A\nkeep\nb\n')
    assert.equal(remaining[0].after, 'A\nkeep\nB\n')
  } finally { assert.equal(path.relative(os.tmpdir(), root).startsWith('..'), false); await rm(root, { recursive: true, force: true }) }
})
