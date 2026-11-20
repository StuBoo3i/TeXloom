import test from 'node:test'
import assert from 'node:assert/strict'
import { headingLine, imageLatex, linkLatex, listLatex, tableLatex } from '../client/src/latex-edit'
import { buildOutline, replaceSource, searchSources } from '../client/src/project-analysis'

test('LaTeX 插入模板生成可用命令', () => {
  assert.equal(headingLine('\\section{旧标题}', 2), '\\subsection{旧标题}')
  assert.match(listLatex('甲\n乙', false), /\\item 甲\n  \\item 乙/)
  assert.match(tableLatex(2, 2, 'A|B\n1|2', '表', 'tab:a'), /A & B \\\\ \\hline/)
  assert.match(imageLatex('images/figure.png', '图', 'fig:a', 80), /\\includegraphics\[width=0\.80\\linewidth\]\{images\/figure\.png\}/)
  assert.equal(linkLatex('https://example.org', '示例'), '\\href{https://example.org}{示例}')
})

test('多文件大纲按照 input 顺序生成', () => {
  const files = new Map([
    ['main.tex', '\\section{引言}\n\\input{chapters/method}\n'],
    ['chapters/method.tex', '\\subsection{方法}\n正文\n'],
  ])
  assert.deepEqual(buildOutline(files, 'main.tex').map(item => [item.title, item.file, item.line]), [
    ['引言', 'main.tex', 1], ['方法', 'chapters/method.tex', 1],
  ])
})

test('搜索选项和替换保持整词语义', () => {
  const files = new Map([['main.tex', 'Alpha alpha alphabet\n']])
  const options = { query: 'alpha', caseSensitive: false, wholeWord: true, regex: false }
  assert.equal(searchSources(files, options).length, 2)
  assert.equal(replaceSource(files.get('main.tex')!, options, 'X').content, 'X X alphabet\n')
  assert.equal(searchSources(files, { ...options, caseSensitive: true }).length, 1)
  assert.equal(searchSources(files, { query: 'A.*a', caseSensitive: true, wholeWord: false, regex: true }).length, 1)
})
