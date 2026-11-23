import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReferenceIndex, referenceLatex } from '../client/src/reference-index'

test('从图、表、公式、章节和文内参考文献生成可选择的引用键', () => {
  const source = [
    '\\section{研究背景}',
    '\\label{sec:intro}',
    '\\begin{figure}\\includegraphics{plot.png}\\caption{节点分布}\\label{graphA}\\end{figure}',
    '\\begin{table}\\caption{实验结果}\\label{tab:results}\\end{table}',
    '\\begin{equation}\\label{eq:energy} E=mc^2\\end{equation}',
    '% \\label{fig:ignored}',
    '\\begin{verbatim}\\label{fig:also-ignored}\\end{verbatim}',
    '\\begin{thebibliography}{9}',
    '\\bibitem[Smith 2024]{smith24} A. Smith, A Study, 2024.',
    '\\bibitem{lee23} B. Lee, Another Study, 2023.',
    '\\end{thebibliography}',
  ].join('\n')
  const index = buildReferenceIndex([{ file: 'main.tex', source }])
  assert.deepEqual(index.references.map(item => [item.value, item.kind]), [
    ['sec:intro', 'section'], ['graphA', 'figure'], ['tab:results', 'table'], ['eq:energy', 'equation'],
  ])
  assert.equal(index.references[1].title, '节点分布')
  assert.equal(index.references[2].title, '实验结果')
  assert.equal(index.references[0].offset, source.indexOf('\\section{'))
  assert.equal(index.references[1].offset, source.indexOf('\\label{graphA}'))
  assert.equal(index.references[3].offset, source.indexOf('\\label{eq:energy}'))
  assert.deepEqual(index.citations.map(item => item.value), ['smith24', 'lee23'])
  assert.equal(index.citations[1].offset, source.indexOf('\\bibitem{lee23}'))
  assert.equal(referenceLatex(index.references[3]), '\\eqref{eq:energy}')
  assert.equal(referenceLatex(index.citations[0]), '\\cite{smith24}')
})

test('从 .bib 读取嵌套标题、作者和年份，排除注释并按键去重', () => {
  const bib = [
    '% @article{ignored, title={Wrong}}',
    '@comment{ @article{nested, title={Wrong}} }',
    '@article{smith24, title = {Graphs and {Networks}}, author = {Alice Smith}, year = {2024}}',
    '@book{brown22, title = "Large Graphs", author = {B. Brown}, year = 2022}',
  ].join('\r\n')
  const index = buildReferenceIndex([
    { file: 'main.tex', source: '\\begin{thebibliography}{9}\\bibitem{smith24} Smith paper.\\end{thebibliography}' },
    { file: 'refs.bib', source: bib },
  ])
  assert.deepEqual(index.citations.map(item => item.value), ['smith24', 'brown22'])
  assert.equal(index.citations[0].source, 'thebibliography')
  assert.equal(index.citations[1].title, 'Large Graphs')
  assert.equal(index.citations[1].offset, bib.indexOf('@book{brown22'))
  assert.match(index.citations[1].detail, /B\. Brown.*2022/)
})
