// CLI models commonly use LaTeX delimiters rather than Markdown's $...$.
// Preserve fenced and inline code while normalizing prose for remark-math.
export function normalizeAgentMath(source: string): string {
  const convert = (text: string) => text.replace(/(`+)[^\n]*?\1|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, (match, code: string | undefined, inline: string | undefined, display: string | undefined) => {
    if (code) return match
    if (inline !== undefined) return '$' + inline + '$'
    return '\n$$\n' + display + '\n$$\n'
  })
  let output = ''
  let prose = ''
  let fence: { character: string; length: number } | null = null
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (!fence && marker) {
      output += convert(prose) + line
      prose = ''
      fence = { character: marker[1][0], length: marker[1].length }
    } else if (fence) {
      output += line
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = null
    } else prose += line
  }
  return output + convert(prose)
}
