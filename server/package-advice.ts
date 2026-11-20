export type PackageInfo = { key: string; title: string; purpose: string; cues: RegExp[]; commands: RegExp[]; note?: string }
export type PackageSuggestion = { key: string; title: string; reason: string; installed: boolean; ctanUrl: string; note?: string; source: 'local' | 'ai' }

export const packageCatalog: PackageInfo[] = [
  { key: 'amsmath', title: '多行公式与数学环境', purpose: '提供 align、gather 等数学环境和扩展公式命令', cues: [/公式|equation|math|align|数学/i], commands: [/\\begin\{(?:align|gather|multline|split)\}/, /\\(?:dfrac|text|tag)\b/] },
  { key: 'amssymb', title: '数学符号', purpose: '补充常用数学符号', cues: [/数学符号|math symbols?|特殊符号/i], commands: [/\\(?:mathbb|leqslant|varnothing|nexists)\b/] },
  { key: 'amsthm', title: '定理环境', purpose: '定义定理、引理和证明环境', cues: [/定理|证明|引理|theorem|lemma|proof/i], commands: [/\\(?:newtheorem|theoremstyle)\b/] },
  { key: 'mathtools', title: '数学公式增强', purpose: '扩展 amsmath 的公式排版工具', cues: [/公式对齐|公式编号|cases|mathtools/i], commands: [/\\(?:coloneqq|prescript|shortintertext|mathclap)\b/] },
  { key: 'bm', title: '粗体数学符号', purpose: '为数学符号提供粗体命令', cues: [/粗体数学|粗体向量|bold math|bold symbol/i], commands: [/\\bm\b/] },
  { key: 'graphicx', title: '插入图片', purpose: '支持 includegraphics 与图片尺寸设置', cues: [/图片|插图|figure|image|graphics/i], commands: [/\\includegraphics\b/] },
  { key: 'subcaption', title: '子图与子标题', purpose: '在图表中编排子图和子标题', cues: [/子图|并排图片|subfigure|subcaption/i], commands: [/\\begin\{subfigure\}/] },
  { key: 'caption', title: '图表标题样式', purpose: '调整图表标题格式', cues: [/图表标题|caption style|标题样式/i], commands: [/\\captionsetup\b/] },
  { key: 'booktabs', title: '三线表', purpose: '提供 top、mid、bottom 三线表横线', cues: [/三线表|booktabs|publication table/i], commands: [/\\(?:toprule|midrule|bottomrule|cmidrule)\b/] },
  { key: 'tabularx', title: '自适应宽度表格', purpose: '让表格列自动分配宽度', cues: [/自适应表格|自动列宽|tabularx/i], commands: [/\\begin\{tabularx\}/] },
  { key: 'longtable', title: '跨页表格', purpose: '处理跨页长表格', cues: [/跨页表格|长表格|longtable/i], commands: [/\\begin\{longtable\}/] },
  { key: 'multirow', title: '跨行单元格', purpose: '合并表格的多个行单元格', cues: [/跨行|合并单元格|multirow/i], commands: [/\\multirow\b/] },
  { key: 'array', title: '表格列格式', purpose: '定义扩展的表格列类型', cues: [/列格式|表格列|arraybackslash/i], commands: [/\\(?:newcolumntype|arraybackslash)\b/] },
  { key: 'siunitx', title: '数值与单位', purpose: '统一数字、单位及数值列排版', cues: [/单位|科学计数|数值列|siunitx|unit/i], commands: [/\\(?:SI|si|qty|unit|num)\b/] },
  { key: 'geometry', title: '页面边距', purpose: '设置纸张尺寸和页边距', cues: [/页边距|页面尺寸|margin|geometry/i], commands: [/\\geometry\b/] },
  { key: 'hyperref', title: '超链接', purpose: '让链接、目录和交叉引用具备跳转能力', cues: [/超链接|目录跳转|hyperlink|href/i], commands: [/\\(?:href|hypersetup|url)\b/] },
  { key: 'cleveref', title: '智能交叉引用', purpose: '自动生成图、表、公式等引用前缀', cues: [/智能引用|交叉引用|cleveref|cref/i], commands: [/\\(?:cref|Cref)\b/] },
  { key: 'xcolor', title: '颜色', purpose: '设置文字与图形颜色', cues: [/颜色|高亮|color/i], commands: [/\\(?:definecolor|textcolor|colorbox)\b/] },
  { key: 'enumitem', title: '列表布局', purpose: '控制枚举列表的编号与间距', cues: [/列表间距|自定义编号|enumitem/i], commands: [/\\setlist\b/] },
  { key: 'tikz', title: '矢量绘图', purpose: '在 LaTeX 中绘制图形和示意图', cues: [/绘图|流程图|tikz|diagram/i], commands: [/\\begin\{tikzpicture\}/, /\\usetikzlibrary\b/] },
  { key: 'pgfplots', title: '数据绘图', purpose: '基于 PGF 绘制函数与数据图', cues: [/数据图|函数图|坐标轴|pgfplots/i], commands: [/\\begin\{axis\}/, /\\pgfplotsset\b/] },
  { key: 'listings', title: '代码清单', purpose: '展示带样式的代码片段', cues: [/代码清单|代码高亮|listings|source code/i], commands: [/\\(?:lstset|lstinputlisting)\b/, /\\begin\{lstlisting\}/] },
  { key: 'natbib', title: '文献引用格式', purpose: '提供 citep、citet 等引用形式', cues: [/作者年份|文献引用|natbib|citep|citet/i], commands: [/\\(?:citep|citet)\b/] },
  { key: 'ctex', title: '中文排版', purpose: '提供中文文档支持和标题本地化', cues: [/中文排版|汉字|ctex|chinese/i], commands: [/\\(?:ctexset|zihao)\b/] },
  { key: 'fontspec', title: '系统字体', purpose: '指定 XeTeX 可用的系统字体', cues: [/字体设置|系统字体|fontspec|font/i], commands: [/\\(?:setmainfont|setsansfont|setmonofont)\b/] },
  { key: 'fancyhdr', title: '页眉页脚', purpose: '自定义页眉、页脚和页码', cues: [/页眉|页脚|fancyhdr|header|footer/i], commands: [/\\(?:fancyhead|fancyfoot|pagestyle\{fancy\})/] },
]

export function installedPackages(source: string): Set<string> {
  const preamble = source.split(/\\begin\s*\{document\}/)[0]
  const cleaned = preamble.split(/\r?\n/).map(line => line.replace(/(^|[^\\])%.*/, '$1')).join('\n')
  const names = new Set<string>()
  for (const match of cleaned.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) for (const value of match[1].split(',')) names.add(value.trim().toLowerCase())
  const documentClass = cleaned.match(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/)?.[1]?.toLowerCase()
  if (documentClass === 'ctexart' || documentClass === 'ctexbook' || documentClass === 'ctexrep') names.add('ctex')
  return names
}

export function localPackageAdvice(source: string, goal: string, log = ''): PackageSuggestion[] {
  const installed = installedPackages(source)
  const text = source.replace(/(^|[^\\])%.*/g, '$1').slice(0, 80_000)
  return packageCatalog.map(item => {
    const goalMatch = item.cues.some(cue => cue.test(goal))
    const sourceMatch = item.commands.some(command => command.test(text))
    const logMatch = item.commands.some(command => command.test(log))
    const score = (goalMatch ? 3 : 0) + (sourceMatch ? 2 : 0) + (logMatch ? 3 : 0)
    return { item, score, reason: logMatch ? `编译日志涉及相关命令；${item.purpose}` : sourceMatch ? `源码使用了相关命令；${item.purpose}` : item.purpose }
  }).filter(value => value.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(({ item, reason }) => ({ key: item.key, title: item.title, reason, installed: installed.has(item.key), ctanUrl: `https://ctan.org/pkg/${item.key}`, note: item.note, source: 'local' as const }))
}

export function packageInsertion(source: string, key: string): { content: string; insertion: string; line: number } {
  if (!packageCatalog.some(item => item.key === key)) throw new Error('未收录的宏包')
  if (installedPackages(source).has(key)) throw new Error('此宏包已在导言区加载')
  const begin = source.search(/\\begin\s*\{document\}/)
  if (begin < 0) throw new Error('主文件缺少 \\begin{document}，请手动编辑导言区')
  const preamble = source.slice(0, begin)
  const insertion = `\\usepackage{${key}}\n`
  const separator = preamble && !preamble.endsWith('\n') ? '\n' : ''
  const content = preamble + separator + insertion + source.slice(begin)
  return { content, insertion, line: preamble.split('\n').length + (separator ? 1 : 0) }
}

export function validateAiAdvice(raw: unknown, source: string): PackageSuggestion[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { packages?: unknown }).packages)) throw new Error('AI 返回的宏包列表格式无效')
  const installed = installedPackages(source)
  const seen = new Set<string>()
  const result: PackageSuggestion[] = []
  for (const item of (raw as { packages: unknown[] }).packages.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const value = item as { key?: unknown; reason?: unknown }
    if (typeof value.key !== 'string' || typeof value.reason !== 'string') continue
    const key = value.key.trim().toLowerCase()
    const known = packageCatalog.find(entry => entry.key === key)
    if (!known || seen.has(key) || !value.reason.trim()) continue
    seen.add(key)
    result.push({ key, title: known.title, reason: value.reason.trim().slice(0, 240), installed: installed.has(key), ctanUrl: `https://ctan.org/pkg/${key}`, source: 'ai', note: known.note })
  }
  return result
}
