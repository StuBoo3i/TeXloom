import { setLanguage, t, useLanguage, type Language } from './i18n'
import { Check } from 'lucide-react'
import { mikuArtwork, signatureThemes, themes, type Appearance, type FontId } from './appearance'
import './appearance-settings.css'

const fonts: { id: FontId; name: string }[] = [
  { id: 'system', get name() { return t("系统默认") } },
  { id: 'sans', get name() { return t("现代黑体") } },
  { id: 'serif', get name() { return t("书籍宋体") } },
  { id: 'mono', get name() { return t("等宽字体") } },
]

export function AppearanceSettings({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  const language = useLanguage()
  return <section className="appearance-settings" aria-label={t("页面外观")}>
    <strong>{t("页面外观")}</strong>
    <label>{t("界面语言")}
      <select value={language} onChange={event => setLanguage(event.target.value as Language)}>
        <option value="zh-CN" lang="zh-CN">简体中文</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
    <label>{t("网页字体")}<select value={value.font} onChange={event => onChange({ ...value, font: event.target.value as FontId })}>{fonts.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}</select></label>
    <label>{t("网页字号")}<select value={value.size} onChange={event => onChange({ ...value, size: Number(event.target.value) })}>{[12, 13, 14, 15, 16, 17, 18].map(size => <option key={size} value={size}>{size} px{size === 14 ? " " + t("· 默认") : ''}</option>)}</select></label>
    <span className="appearance-label">{t("招牌配色")}</span>
    <div className="signature-options" role="group" aria-label={t("招牌配色")}>
      {signatureThemes.map(theme => <button key={theme.id} type="button" aria-pressed={value.theme === theme.id}
        onClick={() => onChange({ ...value, theme: theme.id })}>
        <span className="signature-swatch" style={{ background: theme.swatch }} aria-hidden="true" />
        <span><strong>{t(theme.name)}</strong><small>{t(theme.caption)}</small></span>
        {value.theme === theme.id && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>
    <span className="appearance-label">{t("角色主题")}</span>
    <button type="button" className="miku-theme-option" aria-pressed={value.theme === 'miku'}
      onClick={() => onChange({ ...value, theme: 'miku' })}>
      <img src={mikuArtwork} loading="lazy" decoding="async" alt="" />
      <span className="miku-theme-option-copy"><strong>{t("初音未来")}</strong><small>{t("青音工作室")}</small></span>
      {value.theme === 'miku' && <Check className="miku-theme-check" size={15} aria-hidden="true" />}
    </button>
    <span className="appearance-label">{t("其他配色")}</span>
    <div className="theme-options" role="group" aria-label={t("颜色风格")}>{themes.map(theme => <button key={theme.id} type="button" className={value.theme === theme.id ? 'selected' : ''} aria-pressed={value.theme === theme.id} onClick={() => onChange({ ...value, theme: theme.id })}><span className="theme-swatch" style={{ background: theme.swatch }} />{t(theme.name)}{value.theme === theme.id && <Check size={13} />}</button>)}</div>
    <p>{t("设置仅保存在本机浏览器，PDF 的排版与字体由 LaTeX 源码决定。")}</p>
  </section>
}
