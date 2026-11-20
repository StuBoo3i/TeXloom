import { useEffect, useState } from 'react'
import { imageLatex, linkLatex, tableLatex } from './latex-edit'
import './insert-dialog.css'

export type InsertKind = 'symbol' | 'link' | 'reference' | 'citation' | 'image' | 'table'
export type ImageSource = 'local' | 'project' | 'other' | 'url'
type Item = { value: string; file: string }
type ProjectOption = { id: string; name: string }

const symbolGroups = [
  { name: '希腊字母', symbols: [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['θ', '\\theta'], ['λ', '\\lambda'], ['μ', '\\mu'], ['π', '\\pi'], ['σ', '\\sigma'], ['ω', '\\omega']] },
  { name: '数学运算符', symbols: [['∑', '\\sum'], ['∫', '\\int'], ['×', '\\times'], ['·', '\\cdot'], ['±', '\\pm'], ['∞', '\\infty'], ['∂', '\\partial'], ['∇', '\\nabla']] },
  { name: '关系符号', symbols: [['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['≈', '\\approx'], ['∈', '\\in'], ['⊂', '\\subset'], ['⊆', '\\subseteq']] },
  { name: '箭头', symbols: [['→', '\\rightarrow'], ['←', '\\leftarrow'], ['↔', '\\leftrightarrow'], ['⇒', '\\Rightarrow'], ['⇔', '\\Leftrightarrow']] },
] as const

const titles: Record<InsertKind, string> = { symbol: '插入符号', link: '插入链接', reference: '插入交叉引用', citation: '插入文献引用', image: '插入图片', table: '插入表格' }
const imageSources: { id: ImageSource; label: string }[] = [{ id: 'local', label: '本机上传' }, { id: 'project', label: '项目文件' }, { id: 'other', label: '其他项目' }, { id: 'url', label: 'URL' }]

export function InsertDialog({ kind, initialSource, initialSymbolGroup = 0, initialTableMode = 'size', selectedText, references, citations, imageFiles, projects, currentProjectId, onClose, onInsert, onUploadImage, onCopyImage, onImportImageUrl, onListProjectFiles, onImageTableAi }: {
  kind: InsertKind; initialSource?: ImageSource; initialSymbolGroup?: number; initialTableMode?: 'size' | 'text' | 'image'; selectedText: string; references: Item[]; citations: Item[];
  imageFiles: string[]; projects: ProjectOption[]; currentProjectId: string; onClose: () => void;
  onInsert: (text: string, requiredPackage?: 'graphicx' | 'hyperref') => Promise<void>;
  onUploadImage: (file: File) => Promise<string>; onCopyImage: (projectId: string, file: string) => Promise<string>;
  onImportImageUrl: (url: string) => Promise<string>; onListProjectFiles: (projectId: string) => Promise<string[]>;
  onImageTableAi: (file: File) => void;
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [symbolGroup, setSymbolGroup] = useState(initialSymbolGroup)
  const [url, setUrl] = useState('')
  const [linkText, setLinkText] = useState(selectedText)
  const [reference, setReference] = useState(references[0]?.value ?? '')
  const [citation, setCitation] = useState(citations[0]?.value ?? '')
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

  useEffect(() => { if (!reference && references[0]) setReference(references[0].value) }, [references])
  useEffect(() => { if (!citation && citations[0]) setCitation(citations[0].value) }, [citations])
  useEffect(() => { if (!projectFile && imageFiles[0]) setProjectFile(imageFiles[0]) }, [imageFiles])

  useEffect(() => {
    if (kind !== 'image' || !otherProject || imageSource !== 'other') return
    let cancelled = false
    void onListProjectFiles(otherProject).then(paths => { if (!cancelled) { setOtherFiles(paths); setOtherFile(paths[0] ?? '') } }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { cancelled = true }
  }, [kind, imageSource, otherProject])

  async function submit(text: string, requiredPackage?: 'graphicx' | 'hyperref') {
    setBusy(true); setError('')
    try { await onInsert(text, requiredPackage); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function submitImage() {
    setBusy(true); setError('')
    try {
      let file = ''
      if (imageSource === 'local') { if (!imageFile) throw new Error('请选择图片'); file = await onUploadImage(imageFile) }
      if (imageSource === 'project') { if (!projectFile) throw new Error('请选择项目图片'); file = projectFile }
      if (imageSource === 'other') { if (!otherProject || !otherFile) throw new Error('请选择其他项目中的图片'); file = await onCopyImage(otherProject, otherFile) }
      if (imageSource === 'url') { if (!url.trim()) throw new Error('请输入图片 URL'); file = await onImportImageUrl(url.trim()) }
      await onInsert(imageLatex(file, caption, label, width), 'graphicx')
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <div className="insert-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="insert-dialog" role="dialog" aria-modal="true" aria-label={titles[kind]}>
      <div className="insert-dialog-head"><h2>{titles[kind]}</h2><button onClick={onClose} aria-label="关闭" title="关闭">×</button></div>
      <div className="insert-dialog-body">
        {kind === 'symbol' && <><div className="insert-tabs">{symbolGroups.map((group, index) => <button key={group.name} className={symbolGroup === index ? 'active' : ''} onClick={() => setSymbolGroup(index)}>{group.name}</button>)}</div><div className="symbol-grid">{symbolGroups[symbolGroup].symbols.map(([glyph, command]) => <button key={command} title={command} onClick={() => void submit(`\\ensuremath{${command}}`)}><span>{glyph}</span><small>{command}</small></button>)}</div></>}
        {kind === 'link' && <div className="insert-fields"><label>链接地址<input autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.org" /></label><label>显示文字<input value={linkText} onChange={event => setLinkText(event.target.value)} placeholder="链接文字" /></label></div>}
        {kind === 'reference' && <div className="insert-fields"><label>标签<input autoFocus list="reference-options" value={reference} onChange={event => setReference(event.target.value)} placeholder="例如 sec:intro" /></label><datalist id="reference-options">{references.map(item => <option key={`${item.file}:${item.value}`} value={item.value}>{item.file}</option>)}</datalist><p>从项目中的 <code>\label{'{...}'}</code> 提取，也可手动输入。</p></div>}
        {kind === 'citation' && <div className="insert-fields"><label>文献键<input autoFocus list="citation-options" value={citation} onChange={event => setCitation(event.target.value)} placeholder="例如 Smith2024" /></label><datalist id="citation-options">{citations.map(item => <option key={`${item.file}:${item.value}`} value={item.value}>{item.file}</option>)}</datalist><p>从项目中的 <code>.bib</code> 文件提取，也可手动输入。</p></div>}
        {kind === 'image' && <><div className="insert-tabs">{imageSources.map(item => <button key={item.id} className={imageSource === item.id ? 'active' : ''} onClick={() => setImageSource(item.id)}>{item.label}</button>)}</div><div className="insert-fields">
          {imageSource === 'local' && <label>本机图片<input type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" onChange={event => setImageFile(event.target.files?.[0] ?? null)} /></label>}
          {imageSource === 'project' && <label>当前项目图片<select value={projectFile} onChange={event => setProjectFile(event.target.value)}><option value="">请选择</option>{imageFiles.map(file => <option key={file} value={file}>{file}</option>)}</select></label>}
          {imageSource === 'other' && <><label>来源项目<select value={otherProject} onChange={event => setOtherProject(event.target.value)}><option value="">请选择</option>{projects.filter(item => item.id !== currentProjectId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>图片文件<select value={otherFile} onChange={event => setOtherFile(event.target.value)}><option value="">请选择</option>{otherFiles.map(file => <option key={file} value={file}>{file}</option>)}</select></label></>}
          {imageSource === 'url' && <label>图片 URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.org/figure.png" /></label>}
          <label>宽度（页面宽度百分比）<input type="number" min="10" max="100" value={width} onChange={event => setWidth(Number(event.target.value))} /></label><label>图注（可选）<input value={caption} onChange={event => setCaption(event.target.value)} /></label><label>标签（可选）<input value={label} onChange={event => setLabel(event.target.value)} placeholder="fig:example" /></label>
        </div></>}
        {kind === 'table' && <><div className="insert-tabs"><button className={tableMode === 'size' ? 'active' : ''} onClick={() => setTableMode('size')}>选择行列</button><button className={tableMode === 'text' ? 'active' : ''} onClick={() => setTableMode('text')}>从文本生成</button><button className={tableMode === 'image' ? 'active' : ''} onClick={() => setTableMode('image')}>从图片识别 AI</button></div>{tableMode === 'image' ? <div className="insert-fields"><label>表格图片<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={event => setTableImage(event.target.files?.[0] ?? null)} /></label><p>图片将发送给你配置的 DeepSeek 模型，生成的 LaTeX 会先显示预览。</p></div> : <div className="insert-fields"><div className="table-dimensions"><label>行数<input type="number" min="1" max="20" value={rows} onChange={event => setRows(Number(event.target.value))} /></label><label>列数<input type="number" min="1" max="12" value={columns} onChange={event => setColumns(Number(event.target.value))} /></label></div>{tableMode === 'text' && <label>表格内容（Tab 或 | 分列）<textarea rows={5} value={tableSource} onChange={event => setTableSource(event.target.value)} placeholder="名称 | 数值\n甲 | 10" /></label>}<label>表题（可选）<input value={caption} onChange={event => setCaption(event.target.value)} /></label><label>标签（可选）<input value={label} onChange={event => setLabel(event.target.value)} placeholder="tab:example" /></label></div>}</>}
        {error && <div className="insert-error" role="alert">{error}</div>}
      </div>
      {kind !== 'symbol' && <div className="insert-dialog-actions"><button onClick={onClose} disabled={busy}>取消</button><button disabled={busy} onClick={() => {
        if (kind === 'link') { try { void submit(linkLatex(url, linkText), 'hyperref') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
        if (kind === 'reference') { if (!/^[^{}\\,\s]+$/.test(reference.trim())) setError('请输入有效的标签'); else void submit(`\\ref{${reference.trim()}}`) }
        if (kind === 'citation') { if (!/^[^{}\\,\s]+$/.test(citation.trim())) setError('请输入有效的文献键'); else void submit(`\\cite{${citation.trim()}}`) }
        if (kind === 'image') void submitImage()
        if (kind === 'table') { if (tableMode === 'image') { if (!tableImage) setError('请选择图片'); else { onImageTableAi(tableImage); onClose() } } else { try { void submit(tableLatex(rows, columns, tableMode === 'text' ? tableSource : '', caption, label)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } } }
      }}>{busy ? '处理中…' : kind === 'table' && tableMode === 'image' ? '开始识别' : '插入'}</button></div>}
    </div>
  </div>
}
