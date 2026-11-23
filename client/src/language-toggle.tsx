import { Globe2 } from 'lucide-react'
import { setLanguage, t, useLanguage } from './i18n'
import './language-toggle.css'

export function LanguageToggle() {
  const current = useLanguage()
  const next = current === 'en' ? 'zh-CN' : 'en'
  return <button type="button" className="language-toggle" onClick={() => setLanguage(next)}
    aria-label={next === 'en' ? 'Switch to English' : '切换为简体中文'} title={t("切换语言")}>
    <Globe2 size={15} aria-hidden="true" /><span lang={next}>{next === 'en' ? 'EN' : '中文'}</span>
  </button>
}
