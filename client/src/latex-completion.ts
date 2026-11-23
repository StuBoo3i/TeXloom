import { t } from './i18n'
import type * as Monaco from 'monaco-editor'
import { latexLanguageId } from './latex-language'

export type CompletionContext = {
  references: { value: string; file: string }[]
  citations: { value: string; file: string }[]
  files: { path: string; type: 'file' | 'directory' }[]
}
export type LatexSuggestion = { label: string; insert: string; replaceFrom: number; kind: 'command' | 'environment' | 'symbol' | 'reference' | 'file' | 'package'; detail: string; snippet?: boolean }

type Entry = { command: string; insert?: string; detail: string; kind?: LatexSuggestion['kind']; math?: boolean }
const commands: Entry[] = [
  ...'documentclass usepackage RequirePackage input include includeonly title author date maketitle tableofcontents listoffigures listoftables appendix chapter part section subsection subsubsection paragraph subparagraph label ref eqref pageref autoref cite citep citet nocite bibliography bibliographystyle addbibresource printbibliography footnote marginpar textbf textit emph underline texttt textsc textrm textsf textcolor color href url includegraphics caption centering hfill vfill newpage clearpage pagebreak noindent item setlength newcommand renewcommand providecommand DeclareMathOperator'.split(' ').map(command => ({ command, detail: 'LaTeX 命令' })),
  ...'frac dfrac tfrac sqrt sum prod int iint iiint oint lim log ln exp sin cos tan min max sup inf arg det gcd cdot times div pm mp leq geq neq approx sim equiv infty partial nabla forall exists in notin subset subseteq superset superseteq cup cap setminus emptyset to mapsto rightarrow leftarrow Leftrightarrow Rightarrow implies iff ldots cdots vdots ddots overline underline widehat widetilde boldsymbol mathbf mathcal mathbb mathrm mathit operatorname text left right middle begin end'.split(' ').map(command => ({ command, detail: '数学命令', math: true })),
  ...'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ').map(command => ({ command, detail: '希腊字母', kind: 'symbol' as const, math: true })),
  ...'toprule midrule bottomrule cmidrule multicolumn multirow hline cline textwidth linewidth columnwidth pagewidth baselineskip hspace vspace quad qquad'.split(' ').map(command => ({ command, detail: '排版命令' })),
  { command: 'begin', insert: '\\begin{${1:equation}}\n\t$0\n\\end{${1:equation}}', detail: '成对环境', kind: 'environment' },
  { command: 'section', insert: '\\section{${1:标题}}$0', detail: '节标题' },
  { command: 'subsection', insert: '\\subsection{${1:标题}}$0', detail: '小节标题' },
  { command: 'textbf', insert: '\\textbf{${1:文本}}$0', detail: '粗体' },
  { command: 'textit', insert: '\\textit{${1:文本}}$0', detail: '斜体' },
  { command: 'frac', insert: '\\frac{${1:分子}}{${2:分母}}$0', detail: '分式', math: true },
  { command: 'sqrt', insert: '\\sqrt{${1:表达式}}$0', detail: '根式', math: true },
  { command: 'includegraphics', insert: '\\includegraphics[width=${1:0.8}\\linewidth]{${2:images/figure.png}}$0', detail: '插入图片' },
  { command: 'href', insert: '\\href{${1:https://example.org}}{${2:链接文字}}$0', detail: '链接' },
  { command: 'usepackage', insert: '\\usepackage{${1:package}}$0', detail: '加载宏包', kind: 'package' },
  { command: 'item', insert: '\\item ${1:内容}$0', detail: '列表项' },
]
const environments = ['document','abstract','equation','equation*','align','align*','gather','gather*','multline','multline*','split','cases','matrix','pmatrix','bmatrix','vmatrix','figure','figure*','table','table*','tabular','tabularx','longtable','itemize','enumerate','description','quote','quotation','verbatim','theorem','proof','tikzpicture','center','flushleft','flushright','minipage','algorithm','lstlisting']
const packages = ['amsmath','amssymb','mathtools','graphicx','xcolor','hyperref','cleveref','geometry','booktabs','tabularx','longtable','array','multirow','caption','subcaption','enumitem','siunitx','tikz','pgfplots','listings','natbib','ctex','fontspec','microtype','fancyhdr','titlesec','amsthm']
const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

function inComment(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (line[i] === '%' && (i === 0 || line[i - 1] !== '\\')) return true
  return false
}

export function latexSuggestions(source: string, offset: number, context: CompletionContext): LatexSuggestion[] {
  const before = source.slice(0, offset)
  const line = before.slice(before.lastIndexOf('\n') + 1)
  if (inComment(line)) return []
  const verbatim = [...before.matchAll(/\\(begin|end)\{(verbatim|lstlisting|minted)\}/g)].at(-1)
  if (verbatim?.[1] === 'begin') return []
  const brace = line.match(/\\(begin|end|ref|eqref|autoref|pageref|cref|Cref|cite|citep|citet|input|include|includegraphics|usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\{([^{}]*)$/)
  if (brace) {
    const [, command, raw] = brace
    const prefix = raw.split(',').at(-1)?.trimStart() ?? ''
    const from = offset - prefix.length
    let values: string[] = []
    let kind: LatexSuggestion['kind'] = 'reference'
    let detail = ''
    if (command === 'begin' || command === 'end') { values = environments; kind = 'environment'; detail = '环境' }
    else if (/^(?:ref|eqref|autoref|pageref|cref|Cref)$/.test(command)) { values = context.references.map(item => item.value); detail = '项目标签' }
    else if (/^cite/.test(command)) { values = context.citations.map(item => item.value); detail = '文献键' }
    else if (command === 'usepackage' || command === 'RequirePackage') { values = packages; kind = 'package'; detail = '宏包' }
    else { values = context.files.filter(item => item.type === 'file' && (command === 'includegraphics' ? /\.(?:png|jpe?g|pdf)$/i.test(item.path) : /\.tex$/i.test(item.path))).map(item => command === 'includegraphics' ? item.path : item.path.replace(/\.tex$/i, '')); kind = 'file'; detail = '项目文件' }
    return unique(values).filter(value => value.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, 100).map(value => ({ label: value, insert: value, replaceFrom: from, kind, detail }))
  }
  const command = line.match(/\\[A-Za-z@]*$/)
  if (!command) return []
  const prefix = command[0].slice(1).toLowerCase()
  const custom = [...source.matchAll(/\\(?:re)?newcommand\*?\s*\{\s*\\([A-Za-z@]+)\s*\}|\\DeclareMathOperator\*?\s*\{\s*\\([A-Za-z@]+)\s*\}/g)].map(match => match[1] || match[2])
  const entries: Entry[] = [...commands.filter(entry => entry.insert), ...commands, ...unique(custom).map(value => ({ command: value, detail: '项目自定义命令' }))]
  const seen = new Set<string>()
  return entries.filter(entry => {
    if (!entry.command.toLowerCase().startsWith(prefix) || seen.has(entry.command)) return false
    seen.add(entry.command)
    return true
  }).slice(0, 100).map(entry => ({ label: `\\${entry.command}`, insert: entry.insert ?? `\\${entry.command}`, replaceFrom: offset - command[0].length, kind: entry.kind ?? (entry.math ? 'symbol' : 'command'), detail: entry.detail, snippet: Boolean(entry.insert) }))
}

let provider: Monaco.IDisposable | null = null
export function registerLatexCompletion(monaco: typeof Monaco, getContext: () => CompletionContext): void {
  provider?.dispose()
  provider = monaco.languages.registerCompletionItemProvider(latexLanguageId, {
    triggerCharacters: ['\\', '{', ','],
    provideCompletionItems(model, position) {
      const offset = model.getOffsetAt(position)
      const values = latexSuggestions(model.getValue(), offset, getContext())
      const kinds = monaco.languages.CompletionItemKind
      return { suggestions: values.map(item => ({
        label: item.label,
        insertText: item.insert,
        insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column - (offset - item.replaceFrom), endColumn: position.column },
        kind: item.kind === 'environment' ? kinds.Module : item.kind === 'symbol' ? kinds.Color : item.kind === 'reference' ? kinds.Reference : item.kind === 'file' ? kinds.File : item.kind === 'package' ? kinds.Module : kinds.Function,
        detail: t(item.detail),
      })) }
    },
  })
}
