import { t } from './i18n'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { normalizeAgentMath } from './agent-markdown-utils'

export function AgentMarkdown({ text }: { text: string }) {
  return <div className="agent-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]} components={{
    img: ({ alt }) => <span className="agent-markdown-image">{t("[图片：{0}]", alt || t("未提供说明"))}</span>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  }}>{normalizeAgentMath(text)}</Markdown></div>
}
