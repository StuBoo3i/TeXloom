import { Check } from 'lucide-react'
import { themes, type Appearance, type FontId } from './appearance'
import './appearance-settings.css'

const fonts: { id: FontId; name: string }[] = [
  { id: 'system', name: '系统默认' },
  { id: 'sans', name: '现代黑体' },
  { id: 'serif', name: '书籍宋体' },
  { id: 'mono', name: '等宽字体' },
]

export function AppearanceSettings({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  return <section className="appearance-settings" aria-label="页面外观">
    <strong>页面外观</strong>
    <label>网页字体<select value={value.font} onChange={event => onChange({ ...value, font: event.target.value as FontId })}>{fonts.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}</select></label>
    <label>网页字号<select value={value.size} onChange={event => onChange({ ...value, size: Number(event.target.value) })}>{[12, 13, 14, 15, 16, 17, 18].map(size => <option key={size} value={size}>{size} px{size === 14 ? ' · 默认' : ''}</option>)}</select></label>
    <span className="appearance-label">颜色风格</span>
    <div className="theme-options" role="group" aria-label="颜色风格">{themes.map(theme => <button key={theme.id} type="button" className={value.theme === theme.id ? 'selected' : ''} aria-pressed={value.theme === theme.id} onClick={() => onChange({ ...value, theme: theme.id })}><span className="theme-swatch" style={{ background: theme.swatch }} />{theme.name}{value.theme === theme.id && <Check size={13} />}</button>)}</div>
    <p>设置仅保存在本机浏览器，PDF 的排版与字体由 LaTeX 源码决定。</p>
  </section>
}
