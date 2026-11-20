import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { parseSynctex } from '../server/synctex.js'

test('SyncTeX anchors map to project files and PDF points', () => {
  const root = path.resolve('projects', 'sync-test')
  const source = [
    'SyncTeX Version:1',
    `Input:1:${path.join(root, 'main.tex')}`,
    `Input:2:${path.join(root, 'sections', 'intro.tex')}`,
    `Input:3:${path.resolve(root, '..', 'outside.tex')}`,
    'Output:pdf', 'Magnification:1000', 'Unit:1', 'X Offset:0', 'Y Offset:0', 'Content:',
    '{2', '(1,9:6553600,13107200:100,100,0', 'h1,9:6553600,13107200:50,0,0',
    'h2,4:3276800,6553600:50,0,0', 'h3,1:3276800,6553600:50,0,0', '}2',
  ].join('\n')
  assert.deepEqual(parseSynctex(source, root), [
    { file: 'main.tex', line: 9, page: 2, x: 100, y: 200, kind: 'box' },
    { file: 'sections/intro.tex', line: 4, page: 2, x: 50, y: 100, kind: 'text' },
  ])
})
