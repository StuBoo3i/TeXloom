import './ai-diff-dialog.css'

export function AiDiffDialog({ original, proposed, onClose, onApply }: { original: string; proposed: string; onClose: () => void; onApply: () => void }) {
  return <div className="ai-diff-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="ai-diff-dialog" role="dialog" aria-modal="true" aria-label="预览 AI 修改"><h2>预览 AI 修改</h2><div className="ai-diff-columns"><div><strong>原文</strong><pre>{original || '（在光标处插入）'}</pre></div><div><strong>将应用的内容</strong><pre>{proposed}</pre></div></div><div className="ai-diff-actions"><button onClick={onClose}>取消</button><button onClick={onApply}>应用修改</button></div></div></div>
}
