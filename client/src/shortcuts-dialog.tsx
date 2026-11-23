import { t } from './i18n'
import { useLayoutEffect, useRef } from 'react'
import './shortcuts.css'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const mac = /^Mac/.test(navigator.platform)
  const mod = mac ? '⌘' : 'Ctrl'
  const key = (letter: string) => `${mod} + ${letter}`
  const groups = [
    { name: t("常用编辑"), rows: [
      { label: t("保存文件"), keys: [key('S')] },
      { label: t("撤销"), keys: [key('Z')] },
      { label: t("重做"), keys: mac ? [key('Shift + Z')] : [key('Y'), key('Shift + Z')] },
      { label: t("剪切"), keys: [key('X')] },
      { label: t("复制"), keys: [key('C')] },
      { label: t("粘贴"), keys: [key('V')] },
      { label: t("加粗"), keys: [key('B')] },
      { label: t("斜体"), keys: [key('I')] },
    ] },
    { name: t("Visual 编辑"), rows: [
      { label: t("跳转到引用或文献定义"), keys: [key(t("左击"))] },
      { label: t("打开公式编辑"), keys: [t("单击公式")] },
      { label: t("应用公式或源码块编辑"), keys: [key('Enter')] },
      { label: t("取消公式或源码块编辑"), keys: ['Esc'] },
    ] },
    { name: t("补全"), rows: [
      { label: t("手动打开补全"), keys: ['Ctrl + Space'] },
      { label: t("选择候选项"), keys: ['↑', '↓'] },
      { label: t("确认已选候选项"), keys: ['Enter', 'Tab'] },
      { label: t("关闭补全"), keys: ['Esc'] },
    ] },
    { name: t("查找与定位"), rows: [
      { label: t("当前文件查找（Code）"), keys: [key('F')] },
      { label: t("源码定位到 PDF（Code）"), keys: [key(mac ? '⌥ + J' : 'Alt + J')] },
      { label: t("PDF 定位到源码"), keys: [t("双击 PDF 页面")] },
      { label: t("退出专注模式"), keys: ['Esc'] },
    ] },
  ]

  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return <dialog
    ref={dialog}
    className="shortcuts-dialog"
    aria-labelledby="shortcuts-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}
  >
    <header className="shortcuts-header">
      <h2 id="shortcuts-title">{t("快捷键")}</h2>
      <button type="button" onClick={onClose}>{t("关闭")}</button>
    </header>
    <div className="shortcuts-body" tabIndex={0}>
      {groups.map(group => <section key={group.name} className="shortcuts-group">
        <h3>{group.name}</h3>
        <dl>
          {group.rows.map(row => <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.keys.map(binding => <kbd key={binding}>{binding}</kbd>)}</dd>
          </div>)}
        </dl>
      </section>)}
    </div>
  </dialog>
}
