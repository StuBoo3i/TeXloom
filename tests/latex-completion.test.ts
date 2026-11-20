import test from 'node:test'
import assert from 'node:assert/strict'
import { latexSuggestions, type CompletionContext } from '../client/src/latex-completion'

const context: CompletionContext = {
  references: [{ value: 'fig:graph', file: 'main.tex' }, { value: 'sec:intro', file: 'main.tex' }],
  citations: [{ value: 'knuth1984', file: 'refs.bib' }],
  files: [{ path: 'chapters/method.tex', type: 'file' }, { path: 'images/plot.png', type: 'file' }],
}

function suggestions(source: string) { return latexSuggestions(source, source.length, context) }

test('命令优先提供可填写且可撤销的 Monaco 模板', () => {
  const fraction = suggestions('\\frac').find(item => item.label === '\\frac')
  assert.equal(fraction?.snippet, true)
  assert.match(fraction?.insert ?? '', /\$\{1:分子\}/)
  assert.equal(fraction?.replaceFrom, 0)
  assert.match(suggestions('\\beg').find(item => item.label === '\\begin')?.insert ?? '', /\\end/)
})

test('引用、文献、文件、环境和宏包按上下文补全', () => {
  assert.deepEqual(suggestions('\\ref{fig:').map(item => item.label), ['fig:graph'])
  assert.deepEqual(suggestions('\\cite{kn').map(item => item.label), ['knuth1984'])
  assert.deepEqual(suggestions('\\input{chapters/').map(item => item.label), ['chapters/method'])
  assert.deepEqual(suggestions('\\includegraphics{images/').map(item => item.label), ['images/plot.png'])
  assert.ok(suggestions('\\begin{ali').some(item => item.label === 'align'))
  assert.ok(suggestions('\\usepackage{book').some(item => item.label === 'booktabs'))
})

test('识别当前文件自定义命令，跳过注释和逐字环境', () => {
  assert.ok(suggestions('\\newcommand{\\myterm}{text}\n\\myt').some(item => item.label === '\\myterm'))
  assert.deepEqual(suggestions('% \\sec'), [])
  assert.deepEqual(suggestions('\\begin{verbatim}\n\\sec'), [])
  assert.ok(suggestions('\\begin{verbatim}\n\\end{verbatim}\n\\sec').some(item => item.label === '\\section'))
})
