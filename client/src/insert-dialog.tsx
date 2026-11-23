import { t } from './i18n'
import { useEffect, useState } from 'react'
import { imageLatex, linkLatex, tableLatex } from './latex-edit'
import { referenceLatex, type CitationItem, type ReferenceItem } from './reference-index'
import { ReferencePicker, type ReferenceChoice } from './reference-picker'
import './insert-dialog.css'

export type InsertKind = 'symbol' | 'link' | 'reference' | 'citation' | 'image' | 'table'
export type ImageSource = 'local' | 'project' | 'other' | 'url'
type ProjectOption = { id: string; name: string }

const symbolGroups = [
  { get name() { return t("希腊字母") }, symbols: [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['θ', '\\theta'], ['λ', '\\lambda'], ['μ', '\\mu'], ['π', '\\pi'], ['σ', '\\sigma'], ['ω', '\\omega']] },
  { get name() { return t("数学运算符") }, symbols: [['∑', '\\sum'], ['∫', '\\int'], ['×', '\\times'], ['·', '\\cdot'], ['±', '\\pm'], ['∞', '\\infty'], ['∂', '\\partial'], ['∇', '\\nabla']] },
  { get name() { return t("关系符号") }, symbols: [['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['≈', '\\approx'], ['∈', '\\in'], ['⊂', '\\subset'], ['⊆', '\\subseteq']] },
  { get name() { return t("箭头") }, symbols: [['→', '\\rightarrow'], ['←', '\\leftarrow'], ['↔', '\\leftrightarrow'], ['⇒', '\\Rightarrow'], ['⇔', '\\Leftrightarrow']] },
] as const

const titles: Record<InsertKind, string> = { get symbol() { return t("插入符号") }, get link() { return t("插入链接") }, get reference() { return t("插入交叉引用") }, get citation() { return t("插入文献引用") }, get image() { return t("插入图片") }, get table() { return t("插入表格") } }
const imageSources: { id: ImageSource; label: string }[] = [{ id: 'local', get label() { return t("本机上传") } }, { id: 'project', get label() { return t("项目文件") } }, { id: 'other', get label() { return t("其他项目") } }, { id: 'url', label: 'URL' }]

export function InsertDialog({ kind, initialSource, initialSymbolGroup = 0, initialTableMode = 'size', selectedText, references, citations, imageFiles, projects, currentProjectId, onClose, onInsert, onUploadImage, onCopyImage, onImportImageUrl, onListProjectFiles, onImageTableAi, onRefreshReferences }: {
  kind: InsertKind; initialSource?: ImageSource; initialSymbolGroup?: number; initialTableMode?: 'size' | 'text' | 'image'; selectedText: string; references: ReferenceItem[]; citations: CitationItem[];
  imageFiles: string[]; projects: ProjectOption[]; currentProjectId: string; onClose: () => void;
  onInsert: (text: string, requiredPackage?: 'graphicx' | 'hyperref' | 'amsmath') => Promise<void>;
  onUploadImage: (file: File) => Promise<string>; onCopyImage: (projectId: string, file: string) => Promise<string>;
  onImportImageUrl: (url: string) => Promise<string>; onListProjectFiles: (projectId: string) => Promise<string[]>;
  onImageTableAi: (file: File) => void;
  onRefreshReferences: () => Promise<void>;
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [symbolGroup, setSymbolGroup] = useState(initialSymbolGroup)
  const [url, setUrl] = useState('')
  const [linkText, setLinkText] = useState(selectedText)
  const [chosenReference, setChosenReference] = useState<ReferenceChoice | null>(null)
  const [chosenCitation, setChosenCitation] = useState<ReferenceChoice | null>(null)
  const [manualReference, setManualReference] = useState('')
  const [manualCitation, setManualCitation] = useState('')
  const [imageSource, setImageSource] = useState<ImageSource>(initialSource ?? 'local')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [projectFile, setProjectFile] = useState(imageFiles[0] ?? '')
  const [otherProject, setOtherProject] = useState(projects.find(item => item.id !== currentProjectId)?.id ?? '')
  const [otherFiles, setOtherFiles] = useState<string[]>([])
  const [otherFile, setOtherFile] = useState('')
  const [caption, setCaption] = useState('')
  const [label, setLabel] = useState('')
  const [width, setWidth] = useState(80)
  const [rows, setRows] = useState(Math.min(20, Math.max(2, selectedText.trim() ? selectedText.trim().split(/\r?\n/).length : 3)))
  const [columns, setColumns] = useState(Math.min(12, Math.max(2, selectedText.trim() ? selectedText.trim().split(/\r?\n/)[0].split(/\t|\s*\|\s*/).length : 3)))
  const [tableSource, setTableSource] = useState(selectedText)
  const [tableMode, setTableMode] = useState(initialTableMode)
  const [tableImage, setTableImage] = useState<File | null>(null)

  useEffect(() => { if (!projectFile && imageFiles[0]) setProjectFile(imageFiles[0]) }, [imageFiles])

  useEffect(() => {
    if (kind !== 'image' || !otherProject || imageSource !== 'other') return
    let cancelled = false
    void onListProjectFiles(otherProject).then(paths => { if (!cancelled) { setOtherFiles(paths); setOtherFile(paths[0] ?? '') } }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { cancelled = true }
  }, [kind, imageSource, otherProject])

  async function submit(text: string, requiredPackage?: 'graphicx' | 'hyperref' | 'amsmath') {
    setBusy(true); setError('')
    try { await onInsert(text, requiredPackage); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  function submitPicked(mode: 'reference' | 'citation') {
    const manual = (mode === 'reference' ? manualReference : manualCitation).trim()
    if (manual) {
      if (!/^[^{}\\,\s]+$/.test(manual)) { setError(t("请输入有效的引用键")); return }
      void submit(`${mode === 'citation' ? '\\cite' : '\\ref'}{${manual}}`)
      return
    }
    const choice = mode === 'reference' ? chosenReference : chosenCitation
    if (!choice) { setError(t("请从列表中选择一个条目，或手动输入键")); return }
    const current = mode === 'citation' ? citations : [...references, ...citations]
    if (!current.some(item => item.value === choice.value && item.file === choice.file)) { setError(t("所选条目已变化，请重新选择")); return }
    void submit(referenceLatex(choice), !('source' in choice) && choice.kind === 'equation' ? 'amsmath' : undefined)
  }

  async function submitImage() {
    setBusy(true); setError('')
    try {
      let file = ''
      if (imageSource === 'local') { if (!imageFile) throw new Error(t("请选择图片")); file = await onUploadImage(imageFile) }
      if (imageSource === 'project') { if (!projectFile) throw new Error(t("请选择项目图片")); file = projectFile }
      if (imageSource === 'other') { if (!otherProject || !otherFile) throw new Error(t("请选择其他项目中的图片")); file = await onCopyImage(otherProject, otherFile) }
      if (imageSource === 'url') { if (!url.trim()) throw new Error(t("请输入图片 URL")); file = await onImportImageUrl(url.trim()) }
      await onInsert(imageLatex(file, caption, label, width), 'graphicx')
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <div className="insert-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="insert-dialog" role="dialog" aria-modal="true" aria-label={titles[kind]}>
      <div className="insert-dialog-head"><h2>{titles[kind]}</h2><button onClick={onClose} aria-label={t("关闭")} title={t("关闭")}>×</button></div>
      <div className="insert-dialog-body">
        {kind === 'symbol' && <><div className="insert-tabs">{symbolGroups.map((group, index) => <button key={group.name} className={symbolGroup === index ? 'active' : ''} onClick={() => setSymbolGroup(index)}>{group.name}</button>)}</div><div className="symbol-grid">{symbolGroups[symbolGroup].symbols.map(([glyph, command]) => <button key={command} title={command} onClick={() => void submit(`\\ensuremath{${command}}`)}><span>{glyph}</span><small>{command}</small></button>)}</div></>}
        {kind === 'link' && <div className="insert-fields"><label>{t("链接地址")}<input autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.org" /></label><label>{t("显示文字")}<input value={linkText} onChange={event => setLinkText(event.target.value)} placeholder={t("链接文字")} /></label></div>}
        {kind === 'reference' && <ReferencePicker mode="reference" references={references} citations={citations} selected={chosenReference} manualKey={manualReference} onSelect={choice => { setChosenReference(choice); setManualReference('') }} onManual={value => { setManualReference(value); setChosenReference(null) }} onRefresh={onRefreshReferences} />}
        {kind === 'citation' && <ReferencePicker mode="citation" references={references} citations={citations} selected={chosenCitation} manualKey={manualCitation} onSelect={choice => { setChosenCitation(choice); setManualCitation('') }} onManual={value => { setManualCitation(value); setChosenCitation(null) }} onRefresh={onRefreshReferences} />}
        {kind === 'image' && <><div className="insert-tabs">{imageSources.map(item => <button key={item.id} className={imageSource === item.id ? 'active' : ''} onClick={() => setImageSource(item.id)}>{item.label}</button>)}</div><div className="insert-fields">
          {imageSource === 'local' && <label>{t("本机图片")}<input type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" onChange={event => setImageFile(event.target.files?.[0] ?? null)} /></label>}
          {imageSource === 'project' && <label>{t("当前项目图片")}<select value={projectFile} onChange={event => setProjectFile(event.target.value)}><option value="">{t("请选择")}</option>{imageFiles.map(file => <option key={file} value={file}>{file}</option>)}</select></label>}
          {imageSource === 'other' && <><label>{t("来源项目")}<select value={otherProject} onChange={event => setOtherProject(event.target.value)}><option value="">{t("请选择")}</option>{projects.filter(item => item.id !== currentProjectId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>{t("图片文件")}<select value={otherFile} onChange={event => setOtherFile(event.target.value)}><option value="">{t("请选择")}</option>{otherFiles.map(file => <option key={file} value={file}>{file}</option>)}</select></label></>}
          {imageSource === 'url' && <label>{t("图片 URL")}<input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.org/figure.png" /></label>}
          <label>{t("宽度（页面宽度百分比）")}<input type="number" min="10" max="100" value={width} onChange={event => setWidth(Number(event.target.value))} /></label><label>{t("图注（可选）")}<input value={caption} onChange={event => setCaption(event.target.value)} /></label><label>{t("标签（可选）")}<input value={label} onChange={event => setLabel(event.target.value)} placeholder="fig:example" /></label>
        </div></>}
        {kind === 'table' && <><div className="insert-tabs"><button className={tableMode === 'size' ? 'active' : ''} onClick={() => setTableMode('size')}>{t("选择行列")}</button><button className={tableMode === 'text' ? 'active' : ''} onClick={() => setTableMode('text')}>{t("从文本生成")}</button><button className={tableMode === 'image' ? 'active' : ''} onClick={() => setTableMode('image')}>{t("从图片识别 AI")}</button></div>{tableMode === 'image' ? <div className="insert-fields"><label>{t("表格图片")}<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={event => setTableImage(event.target.files?.[0] ?? null)} /></label><p>{t("图片将发送给你配置的 所选 AI 模型，生成的 LaTeX 会先显示预览。")}</p></div> : <div className="insert-fields"><div className="table-dimensions"><label>{t("行数")}<input type="number" min="1" max="20" value={rows} onChange={event => setRows(Number(event.target.value))} /></label><label>{t("列数")}<input type="number" min="1" max="12" value={columns} onChange={event => setColumns(Number(event.target.value))} /></label></div>{tableMode === 'text' && <label>{t("表格内容（Tab 或 | 分列）")}<textarea rows={5} value={tableSource} onChange={event => setTableSource(event.target.value)} placeholder={t("名称 | 数值\\n甲 | 10")} /></label>}<label>{t("表题（可选）")}<input value={caption} onChange={event => setCaption(event.target.value)} /></label><label>{t("标签（可选）")}<input value={label} onChange={event => setLabel(event.target.value)} placeholder="tab:example" /></label></div>}</>}
        {error && <div className="insert-error" role="alert">{error}</div>}
      </div>
      {kind !== 'symbol' && <div className="insert-dialog-actions"><button onClick={onClose} disabled={busy}>{t("取消")}</button><button disabled={busy} onClick={() => {
        if (kind === 'link') { try { void submit(linkLatex(url, linkText), 'hyperref') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
        if (kind === 'reference' || kind === 'citation') submitPicked(kind)
        if (kind === 'image') void submitImage()
        if (kind === 'table') { if (tableMode === 'image') { if (!tableImage) setError(t("请选择图片")); else { onImageTableAi(tableImage); onClose() } } else { try { void submit(tableLatex(rows, columns, tableMode === 'text' ? tableSource : '', caption, label)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } } }
      }}>{busy ? t("处理中…") : kind === 'table' && tableMode === 'image' ? t("开始识别") : t("插入")}</button></div>}
    </div>
  </div>
}
