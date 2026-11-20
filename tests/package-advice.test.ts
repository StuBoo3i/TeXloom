import test from 'node:test'
import assert from 'node:assert/strict'
import { installedPackages, localPackageAdvice, packageInsertion, validateAiAdvice } from '../server/package-advice'

const source = '\\documentclass{article}\n% \\usepackage{fake}\n\\usepackage{graphicx,booktabs}\n\\begin{document}\n\\toprule\n\\end{document}\n'

test('识别导言区已加载的宏包并推荐相关宏包', () => {
  const installed = installedPackages(source)
  assert.ok(installed.has('graphicx'))
  assert.ok(installed.has('booktabs'))
  assert.ok(!installed.has('fake'))
  const advice = localPackageAdvice(source, '想排版多行公式和三线表')
  assert.ok(advice.some(item => item.key === 'amsmath' && !item.installed))
  assert.ok(advice.some(item => item.key === 'booktabs' && item.installed))
})

test('仅允许目录中的 AI 建议，忽略重复和非结构化内容', () => {
  const result = validateAiAdvice({ packages: [
    { key: 'amsmath', reason: '多行公式' }, { key: 'amsmath', reason: '重复' },
    { key: 'shell-escape', reason: '不在白名单中' }, { key: 'booktabs', reason: '三线表' },
  ] }, source)
  assert.deepEqual(result.map(item => item.key), ['amsmath', 'booktabs'])
  assert.equal(result[1].installed, true)
  assert.throws(() => validateAiAdvice({ text: 'anything' }, source))
})

test('将宏包声明插入主文件导言区且禁止重复', () => {
  const change = packageInsertion(source, 'amsmath')
  assert.match(change.content, /\\usepackage\{amsmath\}\n\\begin\{document\}/)
  assert.throws(() => packageInsertion(change.content, 'amsmath'))
  assert.throws(() => packageInsertion(source, 'unknown-package'))
})
