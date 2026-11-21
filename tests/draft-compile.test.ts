import test from 'node:test'
import assert from 'node:assert/strict'
import { draftSource } from '../server/draft-compile'

test('草稿图表占位不改变原文且保留后续行号和引用标签', () => {
  const source = '\\begin{document}\n\\begin{figure}[htbp]\n\\includegraphics{images/a.png}\n\\caption{示意图}\\label{fig:a}\n\\end{figure}\n正文。\n\\end{document}'
  const draft = draftSource(source, 'main.tex', new Set())
  assert.equal(draft.skipped, 1)
  assert.equal(draft.source.split('\n').length, source.split('\n').length)
  assert.ok(draft.source.includes('\\label{fig:a}'))
  assert.ok(draft.source.includes('Draft figure placeholder'))
  assert.equal(draftSource(source, 'main.tex', new Set(['main.tex:label:fig:a'])).source, source)
})

test('独立图片可按卡片选择编译', () => {
  const source = '\\begin{document}\n\\includegraphics[width=.5\\linewidth]{a.png}\n\\end{document}'
  const start = source.indexOf('\\includegraphics')
  assert.ok(draftSource(source, 'main.tex', new Set()).source.includes('Draft image placeholder'))
  assert.equal(draftSource(source, 'main.tex', new Set([`main.tex:offset:${start}`])).source, source)
})
