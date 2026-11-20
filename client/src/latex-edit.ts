export const headingCommands = ['', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'] as const

export function escapeLatexText(value: string): string {
  return value.replace(/\\/g, '\\textbackslash{}').replace(/[{}%$&#_~^]/g, character => ({
    '{': '\\{', '}': '\\}', '%': '\\%', '$': '\\$', '&': '\\&', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
  })[character] ?? character)
}

export function headingLine(line: string, level: number): string {
  const indent = line.match(/^\s*/)?.[0] ?? ''
  const body = line.trim().replace(/^\\(?:section|subsection|subsubsection|paragraph|subparagraph)\*?\{([\s\S]*)\}$/, '$1')
  const command = headingCommands[level]
  if (command === undefined) throw new Error('无效的标题级别')
  return command ? `${indent}\\${command}{${body || '标题'}}` : `${indent}${body}`
}

export function listLatex(selected: string, ordered: boolean): string {
  const entries = selected.trim() ? selected.split(/\r?\n/).filter(line => line.trim()).map(line => line.trim().replace(/^\\item\s*/, '')) : ['列表项']
  const environment = ordered ? 'enumerate' : 'itemize'
  return `\\begin{${environment}}\n${entries.map(line => `  \\item ${line}`).join('\n')}\n\\end{${environment}}${/\r?\n$/.test(selected) ? '\n' : ''}`
}

export function tableLatex(rows: number, columns: number, source: string, caption: string, label: string): string {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 20 || columns < 1 || columns > 12) throw new Error('表格须为 1–20 行、1–12 列')
  const parsed = source.trim() ? source.trim().split(/\r?\n/).map(line => line.split(/\t|\s*\|\s*/)) : []
  const body = Array.from({ length: rows }, (_, row) => {
    const cells = Array.from({ length: columns }, (_, col) => escapeLatexText(parsed[row]?.[col]?.trim() ?? ''))
    return `  ${cells.join(' & ')} \\\\ \\hline`
  }).join('\n')
  const head = '\\begin{table}[htbp]\n\\centering\n'
  const tabular = `\\begin{tabular}{|${'c|'.repeat(columns)}}\n\\hline\n${body}\n\\end{tabular}`
  const optional = `${caption.trim() ? `\n\\caption{${escapeLatexText(caption.trim())}}` : ''}${label.trim() ? `\n\\label{${label.trim()}}` : ''}`
  return `${head}${tabular}${optional}\n\\end{table}`
}

export function imageLatex(file: string, caption: string, label: string, width: number): string {
  if (!file || /[{}\\]/.test(file)) throw new Error('图片路径无效')
  if (!Number.isFinite(width) || width < 10 || width > 100) throw new Error('图片宽度须在 10%–100% 之间')
  return `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=${(width / 100).toFixed(2)}\\linewidth]{${file}}${caption.trim() ? `\n  \\caption{${escapeLatexText(caption.trim())}}` : ''}${label.trim() ? `\n  \\label{${label.trim()}}` : ''}\n\\end{figure}`
}

export function linkLatex(url: string, label: string): string {
  const address = url.trim()
  if (!/^https?:\/\/\S+$/i.test(address) || /[{}\\]/.test(address)) throw new Error('请输入有效的 HTTP 或 HTTPS 链接')
  return `\\href{${address.replace(/%/g, '\\%').replace(/#/g, '\\#')}}{${escapeLatexText(label.trim() || address)}}`
}

export function newAssetPath(name: string): string {
  const clean = name.normalize('NFKC').replace(/[^\p{L}\p{N}._-]/gu, '-').replace(/^\.+/, '').slice(-100)
  if (!/\.(png|jpe?g|pdf)$/i.test(clean)) throw new Error('图片仅支持 PNG、JPEG 或 PDF')
  return `images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`
}
