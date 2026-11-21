export type SuggestedEdit = { path: string; old: string; new: string }
export type SuggestedEdits = { summary: string; edits: SuggestedEdit[] }

export function parseSuggestedEdits(text: string, selectedFiles: string[]): SuggestedEdits | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; edits?: unknown }
    if (typeof value.summary !== 'string' || !Array.isArray(value.edits) || value.edits.length > 20) return null
    const edits: SuggestedEdit[] = []
    for (const item of value.edits) {
      if (!item || typeof item !== 'object') return null
      const edit = item as Record<string, unknown>
      if (typeof edit.path !== 'string' || !selectedFiles.includes(edit.path) || typeof edit.old !== 'string' || !edit.old || edit.old.length > 40_000 || typeof edit.new !== 'string' || edit.new.length > 40_000) return null
      edits.push({ path: edit.path, old: edit.old, new: edit.new })
    }
    return { summary: value.summary.slice(0, 5000), edits }
  } catch { return null }
}

export function applySuggestedEdits(originals: Map<string, { text: string }>, edits: SuggestedEdit[]): Map<string, string> {
  const output = new Map<string, string>()
  for (const edit of edits) {
    const source = output.get(edit.path) ?? originals.get(edit.path)?.text
    if (source === undefined) throw new Error(`${edit.path} 不是可编辑文本文件`)
    const first = source.indexOf(edit.old)
    if (first < 0 || source.indexOf(edit.old, first + edit.old.length) >= 0) throw new Error(`${edit.path} 的替换片段不存在或不唯一`)
    output.set(edit.path, source.slice(0, first) + edit.new + source.slice(first + edit.old.length))
  }
  return output
}
