import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeAgentMath } from '../client/src/agent-markdown-utils.js'

test('Agent Markdown 将正文中的 LaTeX 定界符转换为数学格式', () => {
  assert.equal(normalizeAgentMath('结果 \\(x+1\\) 成立'), '结果 $x+1$ 成立')
  assert.equal(normalizeAgentMath('公式：\\[x^2+1\\]'), '公式：\n$$\nx^2+1\n$$\n')
})

test('代码块与行内代码不改写 LaTeX 定界符', () => {
  const source = '`\\(raw\\)` 与 \\(math\\)\n```tex\n\\[raw\\]\n```\n之后 \\(again\\)'
  const result = normalizeAgentMath(source)
  assert.match(result, /`\\\(raw\\\)` 与 \$math\$/)
  assert.match(result, /```tex\n\\\[raw\\\]\n```/)
  assert.match(result, /之后 \$again\$/)
})
