import { useSyncExternalStore } from 'react'
import english from './locales/en.json'

export type Language = 'zh-CN' | 'en'

const storageKey = 'texloom:language'
const translations: Readonly<Record<string, string>> = english
const listeners = new Set<() => void>()

function readLanguage(): Language {
  if (typeof window === 'undefined') return 'zh-CN'
  const requested = new URL(window.location.href).searchParams.get('lang')
  if (requested === 'en' || requested === 'zh-CN') return requested
  try { return window.localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh-CN' }
  catch { return 'zh-CN' }
}

let language = readLanguage()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const getLanguage = () => language
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage, () => 'zh-CN' as const)

export function setLanguage(next: Language) {
  if (next === language) return
  language = next
  const url = new URL(window.location.href)
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', next)
    window.history.replaceState(window.history.state, '', url)
  }
  try { window.localStorage.setItem(storageKey, next) } catch { /* Keep the in-memory setting. */ }
  listeners.forEach(listener => listener())
}

export function t(source: string, ...parameters: unknown[]): string {
  const template = language === 'en' && Object.hasOwn(translations, source) ? translations[source] : source
  return parameters.length ? template.replace(/\{(\d+)\}/g, (placeholder, index) =>
    Number(index) < parameters.length ? String(parameters[Number(index)]) : placeholder) : template
}
