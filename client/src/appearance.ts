export type ThemeId = 'academic' | 'ocean' | 'violet' | 'forest' | 'night' | 'eye'
export type FontId = 'system' | 'sans' | 'serif' | 'mono'
export type Appearance = { theme: ThemeId; font: FontId; size: number }

export const themes: { id: ThemeId; name: string; swatch: string }[] = [
  { id: 'academic', name: '学术蓝', swatch: '#286799' },
  { id: 'ocean', name: '海洋青', swatch: '#168b95' },
  { id: 'violet', name: '书卷紫', swatch: '#7364ab' },
  { id: 'forest', name: '森林绿', swatch: '#43836b' },
  { id: 'night', name: '夜间模式', swatch: '#263650' },
  { id: 'eye', name: '豆沙绿护眼', swatch: '#c7edcc' },
]

export const fontFamilies: Record<FontId, string> = {
  system: "'DM Sans', 'Microsoft YaHei UI', 'Noto Sans SC', system-ui, sans-serif",
  sans: "Arial, 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  serif: "Georgia, 'Noto Serif CJK SC', 'SimSun', serif",
  mono: "'Cascadia Code', Consolas, 'Microsoft YaHei', monospace",
}

const defaults: Appearance = { theme: 'academic', font: 'system', size: 14 }
const validThemes = new Set(themes.map(theme => theme.id))

export function normalizeAppearance(input: Partial<Appearance> | null | undefined): Appearance {
  return {
    theme: input?.theme && validThemes.has(input.theme) ? input.theme : defaults.theme,
    font: input?.font && input.font in fontFamilies ? input.font : defaults.font,
    size: Number.isInteger(input?.size) && (input?.size ?? 0) >= 12 && (input?.size ?? 0) <= 18 ? input!.size! : defaults.size,
  }
}

export function readAppearance(): Appearance {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem('openleaf:appearance') || 'null') as Partial<Appearance>) }
  catch { return defaults }
}

export function applyAppearance(value: Appearance): void {
  const appearance = normalizeAppearance(value)
  document.documentElement.dataset.theme = appearance.theme
  document.documentElement.style.setProperty('--ui-font-family', fontFamilies[appearance.font])
  document.documentElement.style.setProperty('--ui-font-scale', String(appearance.size / 14))
}

export function saveAppearance(value: Appearance): void {
  const appearance = normalizeAppearance(value)
  localStorage.setItem('openleaf:appearance', JSON.stringify(appearance))
  applyAppearance(appearance)
}
