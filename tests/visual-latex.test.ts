import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVisualLatex, replaceSourceSpan, encodeText, sourceOffsetForVisible, visibleOffsetForSource } from '../client/src/visual-latex'

const sample = [
  '% !TEX program = xelatex\r\n',
  '\\documentclass{article}\r\n',
  '\\usepackage{amsmath}\r\n',
  '\\begin{document}\r\n',
  '\\section{研究\\textbf{背景}}\\label{sec:intro}\r\n',
  '这是一段\\emph{重点}文字，公式 $E=mc^2$，参见 \\ref{sec:intro} 和 \\cite{knuth84}。\r\n',
  '\r\n',
  '\\begin{itemize}\r\n',
  '  \\item 第一项\r\n',
  '  \\item 第二项\\textbf{加粗}\r\n',
  '\\end{itemize}\r\n',
  '\\[a^2+b^2=c^2\\]\r\n',
  '\\begin{tikzpicture}\r\n',
  '  \\draw (0,0) -- (1,1);\r\n',
  '\\end{tikzpicture}\r\n',
  '\\end{document}\r\n',
].join('')

test('解析可视化结构时保留原始字节与可回溯位置', () => {
  const doc = parseVisualLatex(sample)
  assert.equal(doc.source, sample)
  assert.ok(doc.documentFound)
  assert.deepEqual(doc.blocks.map(block => block.kind), ['source', 'heading', 'paragraph', 'blank', 'list', 'math', 'source', 'source'])
  for (const block of doc.blocks) assert.equal(sample.slice(block.start, block.end), block.raw)
  const heading = doc.blocks.find(block => block.kind === 'heading')!
  assert.equal(sample.slice(heading.title!.start, heading.title!.end), '研究\\textbf{背景}')
  assert.ok(doc.blocks.some(block => block.kind === 'source' && block.raw.includes('tikzpicture')))
  const paragraph = doc.blocks.find(block => block.kind === 'paragraph')!
  assert.ok(paragraph.children?.some(node => node.kind === 'math'))
  assert.ok(paragraph.children?.some(node => node.kind === 'reference'))
  assert.ok(paragraph.children?.some(node => node.kind === 'citation'))
})

test('局部修改只替换目标片段，其他源码及换行保持不变', () => {
  const doc = parseVisualLatex(sample)
  const paragraph = doc.blocks.find(block => block.kind === 'paragraph')!
  const emphasis = paragraph.children?.find(node => node.kind === 'italic')!
  const text = emphasis.children?.find(node => node.kind === 'text')!
  const next = replaceSourceSpan(sample, text, text.raw, encodeText('关键内容'))
  assert.equal(next, sample.replace('\\emph{重点}', '\\emph{关键内容}'))
  assert.equal(parseVisualLatex(next).blocks.find(block => block.kind === 'list')?.items?.length, 2)
  assert.throws(() => replaceSourceSpan(next, text, text.raw, '错误覆盖'))
})

test('空行保留独立插入位置及原有换行符', () => {
  const source = '\\begin{document}\r\n\\section{标题}\r\n\r\n  \r\n第一段\r\n\r\n第二段\r\n\\end{document}'
  const blanks = parseVisualLatex(source).blocks.filter(block => block.kind === 'blank')
  assert.deepEqual(blanks.map(block => block.raw), ['\r\n', '  \r\n', '\r\n'])
  assert.deepEqual(blanks.map(block => source.slice(block.content!.start, block.content!.end)), ['', '  ', ''])
  const inserted = replaceSourceSpan(source, blanks[0].content!, '', '新增内容')
  assert.ok(inserted.includes('\\section{标题}\r\n新增内容\r\n  \r\n第一段'))
  assert.equal(parseVisualLatex(inserted).blocks.filter(block => block.kind === 'blank').length, 2)
  const deleted = replaceSourceSpan(source, blanks[0], blanks[0].raw, '')
  assert.ok(deleted.includes('\\section{标题}\r\n  \r\n第一段'))
  assert.equal(parseVisualLatex(deleted).blocks.filter(block => block.kind === 'blank').length, 2)
})

test('未闭合或不支持的内容显示源码块', () => {
  const unfinished = '\\documentclass{article}\n\\begin{document}\n\\begin{tikzpicture}\n\\draw (0,0);'
  const doc = parseVisualLatex(unfinished)
  assert.ok(doc.blocks.some(block => block.kind === 'source' && block.raw.includes('tikzpicture')))
  assert.deepEqual(parseVisualLatex('plain text').blocks.map(block => block.kind), ['source'])
})

test('标题和公式的 label 隐藏且不进入公式编辑片段', () => {
  const source = '\\documentclass{article}\n\\begin{document}\n\\subsection{分离约束}\\label{sec:multiballcapacity}\n正文。\n\\begin{equation}\\label{eq:neighborseparationdemand}\n \\alpha(H)\\le S_d.\n\\end{equation}\n\\end{document}\n'
  const parsed = parseVisualLatex(source)
  const heading = parsed.blocks.find(block => block.kind === 'heading')!
  const math = parsed.blocks.find(block => block.kind === 'math')!
  assert.equal(heading.labels?.length, 1)
  assert.equal(source.slice(heading.title!.start, heading.title!.end), '分离约束')
  assert.equal(math.labels?.length, 1)
  assert.equal(source.slice(math.content!.start, math.content!.end).trim(), '\\alpha(H)\\le S_d.')
  assert.ok(!parsed.blocks.some(block => block.kind === 'source' && block.raw.includes('neighborseparationdemand')))
  const edited = replaceSourceSpan(source, math.content!, source.slice(math.content!.start, math.content!.end), '\n \\alpha(H) < S_d.\n')
  assert.ok(edited.includes('\\label{eq:neighborseparationdemand}'))
  assert.ok(edited.includes('\\label{sec:multiballcapacity}'))
})

test('独立的 label 保留在源码中，但不生成可视化源码块', () => {
  const source = '\\begin{document}\n\\section{标题}\n\\label{sec:x}\n文字\\label{mark:y}。\n\\end{document}'
  const parsed = parseVisualLatex(source)
  assert.equal(parsed.source, source)
  assert.ok(!parsed.blocks.some(block => block.kind === 'source' && block.raw.includes('\\label')))
  assert.ok(!parsed.blocks.some(block => block.kind === 'paragraph' && block.children?.some(node => node.raw.includes('\\label'))))
})

test('Visual 选区转换回源码位置时保留转义字符偏移', () => {
  assert.equal(sourceOffsetForVisible('甲\\%乙', 2), 3)
  assert.equal(sourceOffsetForVisible('a\r\nb', 2), 3)
  assert.equal(sourceOffsetForVisible('abc', 3), 3)
  assert.equal(visibleOffsetForSource('甲\\%乙', 3), 2)
})

test('跨公式选区使用完整 LaTeX 源码而非渲染文本', () => {
  const source = '\\begin{document}\n公式前 $x^2+y^2=z^2$ 公式后。\n\\end{document}'
  const paragraph = parseVisualLatex(source).blocks.find(block => block.kind === 'paragraph')!
  const nodes = paragraph.children!
  const formula = nodes.find(node => node.kind === 'math')!
  assert.equal(source.slice(formula.start, formula.end), '$x^2+y^2=z^2$')
  assert.equal(source.slice(nodes[0].start, nodes.at(-1)!.end), '公式前 $x^2+y^2=z^2$ 公式后。\n')
})

test('标题、摘要和命题证明以正文显示且保留源码范围', () => {
  const source = String.raw`\documentclass{article}
\title{研究题目}
\author{作者}
\begin{document}
\maketitle
\begin{abstract}
摘要文字与 $x^2$。
\end{abstract}
\begin{proposition}[容量界]\label{prop:x}
命题正文。
\end{proposition}
\begin{proof}
\kaishu
证明正文。
\end{proof}
\end{document}`
  const blocks = parseVisualLatex(source).blocks
  assert.deepEqual(blocks.map(block => block.kind), ['source', 'title', 'abstract', 'theorem', 'theorem', 'source'])
  const title = blocks[1]
  assert.equal(source.slice(title.title!.start, title.title!.end), '研究题目')
  assert.equal(blocks[3].labels?.length, 1)
  assert.ok(blocks[3].body?.some(block => block.kind === 'paragraph'))
  assert.ok(blocks[4].body?.some(block => block.kind === 'paragraph'))
})

test('段落高亮保留内文位置与颜色', () => {
  const source = String.raw`\begin{document}
\noindent\colorbox{yellow!25}{%
\parbox{\dimexpr\linewidth-2\fboxsep\relax}{%
高亮内容。%
}%
}
\end{document}`
  const highlight = parseVisualLatex(source).blocks.find(block => block.kind === 'highlight')!
  assert.ok(highlight)
  assert.equal(highlight.name, 'yellow!25')
  assert.ok(source.slice(highlight.content!.start, highlight.content!.end).includes('高亮内容'))
})

test('行首加粗直接显示，图片和表格生成源码映射卡片', () => {
  const source = String.raw`\begin{document}
\textbf{邻近性假设：}正文 $x+y$。
\begin{figure}[htbp]
\centering\includegraphics[width=.7\linewidth]{images/plot.png}
\caption{示意图}\label{fig:plot}
\end{figure}
\begin{table}[htbp]
\begin{tabular}{cc}
甲 & 乙 \\
1 & 2 \\
\end{tabular}
\caption{结果}\label{tab:result}
\end{table}
\end{document}`
  const blocks = parseVisualLatex(source).blocks
  assert.equal(blocks[0].kind, 'paragraph')
  assert.equal(blocks[0].children?.[0].kind, 'bold')
  assert.ok(blocks[0].children?.some(node => node.kind === 'math'))
  assert.equal(blocks[1].kind, 'figure')
  assert.deepEqual(blocks[1].assets, ['images/plot.png'])
  assert.equal(source.slice(blocks[1].caption!.start, blocks[1].caption!.end), '示意图')
  assert.equal(blocks[2].kind, 'table')
  assert.deepEqual(blocks[2].rows?.[0], ['甲', '乙'])
  assert.equal(blocks[2].labels?.length, 1)
})

test('图注和表注完整保留并解析行内公式与格式', () => {
  const source = String.raw`\begin{document}
\begin{figure}
\includegraphics{plot.png}
\caption{APP 邻接模式划分示意图，\textbf{相邻节点 $u,v$ 的距离} 应小于 $S_K=(k_1,k_2)$，因此进一步说明。}
\end{figure}
\begin{table}
\caption{统计结果 $n=20$ 与 \emph{误差分析}}
\begin{tabular}{cc}a & b\end{tabular}
\end{table}
\end{document}`
  const blocks = parseVisualLatex(source).blocks
  const figure = blocks.find(block => block.kind === 'figure')!
  const table = blocks.find(block => block.kind === 'table')!
  assert.equal(source.slice(figure.caption!.start, figure.caption!.end).endsWith('进一步说明。'), true)
  assert.ok(figure.captionChildren?.some(node => node.kind === 'bold' && node.children?.some(child => child.kind === 'math')))
  assert.ok(figure.captionChildren?.some(node => node.kind === 'math'))
  assert.ok(table.captionChildren?.some(node => node.kind === 'math'))
  assert.ok(table.captionChildren?.some(node => node.kind === 'italic'))
})

test('center 包裹的 tabularx 表格显示单元格与公式', () => {
  const source = String.raw`\begin{document}
\section{主要记号}
\begin{center}\small
\begin{tabularx}{\linewidth}{@{}lX@{}}\toprule
记号 & 含义\\\midrule
$U,K,H$ & Unit 成员与诱导图 $H=G[U]$\\
$\mathcal A,\mathcal B$ & 交叉邻接矩阵\\\bottomrule
\end{tabularx}
\end{center}
\end{document}`
  const table = parseVisualLatex(source).blocks.find(block => block.kind === 'table')!
  assert.ok(table)
  assert.equal(table.rows?.length, 3)
  assert.deepEqual(table.rows?.[0], ['记号', '含义'])
  assert.ok(table.tableCells?.[1][0].children.some(node => node.kind === 'math'))
  assert.ok(table.tableCells?.[1][1].children.some(node => node.kind === 'math'))
  assert.equal(source.slice(table.start, table.end).trimEnd().endsWith('\\end{center}'), true)
})
