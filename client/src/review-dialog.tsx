import { t } from './i18n'
import { useState } from 'react'
import './review-dialog.css'

export type ReviewDraft = { type: 'comment' | 'suggestion'; file: string; line: number; column: number; offset: number; original: string }

export function ReviewDialog({ draft, onClose, onSubmit }: { draft: ReviewDraft; onClose: () => void; onSubmit: (body: string, proposed: string) => Promise<void> }) {
  const [body, setBody] = useState('')
  const [proposed, setProposed] = useState(draft.original)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="review-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="review-dialog" onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void onSubmit(body, proposed).then(onClose).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false)) }}>
    <h2>{draft.type === 'suggestion' ? t("提出修改建议") : t("添加评论")}</h2><small>{draft.file}:{draft.line}:{draft.column}</small>
    {draft.original && <pre>{t("选中内容：")}{draft.original}</pre>}
    <label>{draft.type === 'suggestion' ? t("说明") : t("评论内容")}<textarea autoFocus required maxLength={4000} rows={3} value={body} onChange={event => setBody(event.target.value)} placeholder={t("写下你的想法…")} /></label>
    {draft.type === 'suggestion' && <label>{t("建议替换为")}<textarea required rows={5} maxLength={20000} value={proposed} onChange={event => setProposed(event.target.value)} /></label>}
    {error && <p role="alert">{error}</p>}
    <div><button type="button" onClick={onClose}>{t("取消")}</button><button type="submit" disabled={busy || !body.trim() || draft.type === 'suggestion' && !proposed.trim()}>{busy ? t("保存中…") : t("保存")}</button></div>
  </form></div>
}
