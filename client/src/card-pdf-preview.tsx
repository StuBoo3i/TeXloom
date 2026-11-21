import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react'
import { paddedBounds, pdfContentBounds } from './pdf-content-bounds'
import './card-pdf-preview.css'

export function CardPdfPreview({ url }: { url: string }) {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setPdf(null); setPage(1); setReady(false); setError('')
    const task = pdfjsLib.getDocument({ url, withCredentials: false })
    void task.promise.then(document => { if (!cancelled) setPdf(document) }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'PDF 加载失败')
    })
    return () => { cancelled = true; void task.destroy() }
  }, [url])

  useEffect(() => {
    if (!pdf || !canvas.current || !stage.current) return
    let cancelled = false
    let renderTask: ReturnType<pdfjsLib.PDFPageProxy['render']> | undefined
    setReady(false); setError('')
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page)
        if (cancelled) return
        const natural = pdfPage.getViewport({ scale: 1 })
        const maximumScale = Math.sqrt(12_000_000 / (natural.width * natural.height))
        const baseScale = Math.min(1.2, maximumScale)
        const render = async (scale: number) => {
          const viewport = pdfPage.getViewport({ scale })
          const sheet = document.createElement('canvas')
          sheet.width = Math.ceil(viewport.width); sheet.height = Math.ceil(viewport.height)
          const context = sheet.getContext('2d', { alpha: false })
          if (!context) throw new Error('无法创建 PDF 画布')
          context.fillStyle = '#fff'; context.fillRect(0, 0, sheet.width, sheet.height)
          renderTask = pdfPage.render({ canvas: sheet, canvasContext: context, viewport, background: '#ffffff' })
          await renderTask.promise
          let ink = null
          try { ink = pdfContentBounds(context.getImageData(0, 0, sheet.width, sheet.height).data, sheet.width, sheet.height) }
          catch { /* The complete page remains available when pixel inspection is unavailable. */ }
          return { sheet, ink, scale }
        }
        let rendered = await render(baseScale)
        if (cancelled) return
        if (!rendered.ink && page < pdf.numPages) { setPage(page + 1); return }
        if (rendered.ink) {
          const desiredWidth = Math.max(240, (stage.current?.clientWidth ?? 600) - 32) * Math.min(window.devicePixelRatio || 1, 2)
          const detailScale = Math.min(4, maximumScale, Math.max(baseScale, desiredWidth / (rendered.ink.width / baseScale)))
          if (detailScale > baseScale * 1.25) rendered = await render(detailScale)
        }
        if (cancelled || !canvas.current) return
        const bounds = rendered.ink ? paddedBounds(rendered.ink, rendered.sheet.width, rendered.sheet.height, Math.round(12 * rendered.scale)) : { x: 0, y: 0, width: rendered.sheet.width, height: rendered.sheet.height }
        const output = canvas.current
        output.width = bounds.width; output.height = bounds.height
        output.getContext('2d')?.drawImage(rendered.sheet, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height)
        setReady(true)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'PDF 渲染失败')
      }
    })()
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, page])

  return <div className="card-pdf" ref={stage}>
    <div className="card-pdf-toolbar">
      <span>编译预览 · 已裁去页面留白</span>
      <div className="card-pdf-controls">
        {pdf && pdf.numPages > 1 && <><button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} /></button><small>{page} / {pdf.numPages}</small><button type="button" aria-label="下一页" disabled={page >= pdf.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={14} /></button></>}
        <a href={url} target="_blank" rel="noopener noreferrer" title="打开完整 PDF"><ExternalLink size={14} />完整 PDF</a>
        <a href={url} download="card-preview.pdf" title="下载 PDF"><Download size={14} /></a>
      </div>
    </div>
    <div className="card-pdf-stage">
      {!ready && <div className="card-pdf-message" role={error ? 'alert' : 'status'}>{error || '正在排版预览…'}</div>}
      <canvas ref={canvas} aria-label="裁切后的卡片编译结果" style={{ display: ready ? 'block' : 'none' }} />
    </div>
  </div>
}
