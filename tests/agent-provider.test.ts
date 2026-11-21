import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { aiSettingsView, readAiSettings, saveAiSettings } from '../server/ai-settings.js'
import { anthropicDelta, providerRequest, providerText } from '../server/ai-provider.js'
import { codexEvent, codexRunArgs, codexRunOutcome } from '../server/agent-cli.js'
import { readCodexAccount } from '../server/codex-account.js'
import { applySuggestedEdits, parseSuggestedEdits } from '../server/agent-edits.js'

test('旧 DeepSeek 密钥配置迁移且不同服务商互不覆盖', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texloom-ai-test-'))
  try {
    await mkdir(path.join(root, 'data'))
    await writeFile(path.join(root, 'data', 'ai-settings.json'), JSON.stringify({ model: 'deepseek-flash', maxOutputTokens: 1024, timeoutSeconds: 30, encryptedKey: 'old-encrypted' }))
    const settings = await readAiSettings(root)
    assert.equal(settings.profiles.deepseek.encryptedKey, 'old-encrypted')
    settings.provider = 'anthropic'
    settings.profiles.anthropic.encryptedKey = 'new-encrypted'
    await saveAiSettings(root, settings)
    const next = await readAiSettings(root)
    assert.equal(next.profiles.deepseek.encryptedKey, 'old-encrypted')
    assert.equal(next.profiles.anthropic.encryptedKey, 'new-encrypted')
    assert.equal(aiSettingsView(next).configured, true)
    assert.equal((await readFile(path.join(root, 'data', 'ai-settings.json'), 'utf8')).includes('old-encrypted'), true)
  } finally { assert.equal(path.relative(os.tmpdir(), root).startsWith('..'), false); await rm(root, { recursive: true, force: true }) }
})

test('Claude 使用原生 Messages 请求并转换文本事件', () => {
  const request = providerRequest('anthropic', { model: 'claude-test', maxOutputTokens: 500, timeoutSeconds: 30 }, 'secret', [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }], true, new AbortController().signal)
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
  assert.equal((request.init.headers as Record<string, string>)['x-api-key'], 'secret')
  assert.equal(JSON.parse(request.init.body as string).system, 'system')
  assert.equal(anthropicDelta('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}'), '你好')
  assert.equal(providerText('anthropic', { content: [{ type: 'text', text: '{"packages":[]}' }] }).text, '{"packages":[]}')
})

test('DeepSeek、火山引擎、阿里云和 OpenAI 使用各自的兼容接口', () => {
  const urls = {
    deepseek: 'https://api.deepseek.com/chat/completions',
    volcano: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    aliyun: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
  } as const
  for (const [id, url] of Object.entries(urls) as [keyof typeof urls, string][]) {
    const request = providerRequest(id, { model: 'test-model', maxOutputTokens: 512, timeoutSeconds: 30 }, 'test-key', [{ role: 'user', content: 'test' }], false, new AbortController().signal)
    assert.equal(request.url, url)
    assert.equal((request.init.headers as Record<string, string>).Authorization, 'Bearer test-key')
    assert.equal(JSON.parse(request.init.body as string).model, 'test-model')
  }
})

test('Codex JSONL 事件解析不把工具输出当成回答', () => {
  assert.deepEqual(codexEvent({ type: 'thread.started', thread_id: 'abc' }), { type: 'thread', threadId: 'abc' })
  assert.deepEqual(codexEvent({ type: 'item.completed', item: { type: 'agent_message', text: '完成' } }), { type: 'text', text: '完成' })
  assert.equal(codexEvent({ type: 'item.completed', item: { type: 'command_execution', output: 'secret' } }), null)
  assert.deepEqual(codexEvent({ type: 'turn.failed', error: { message: '连接断开' } }), { type: 'failed', text: '连接断开' })
  assert.deepEqual(codexRunOutcome(0, false, '连接断开', '重连失败', ''), { code: -1, error: '连接断开' })
  assert.deepEqual(codexRunOutcome(0, true, '', '曾经重连', ''), { code: 0 })
  assert.deepEqual(codexRunOutcome(1, false, '', '', 'WARN shell_snapshot: Shell snapshot not supported yet for PowerShell'), { code: 1, error: 'Codex CLI 未收到完成事件，回复可能不完整' })
})

test('Codex 初次运行与续接均在草稿目录使用原生工作区写入模式', () => {
  const cwd = 'D:\\projects\\paper'
  const first = codexRunArgs(cwd, undefined, '', 'auto')
  const resumed = codexRunArgs(cwd, 'thread-id', '', 'high')
  assert.deepEqual(first.slice(0, 8), ['-C', cwd, '-s', 'workspace-write', '-a', 'never', 'exec', '--skip-git-repo-check'])
  assert.equal(first.includes('--ignore-user-config'), false)
  assert.equal(first.includes('--dangerously-bypass-approvals-and-sandbox'), false)
  assert.equal(first.at(-1), '-')
  assert.deepEqual(resumed.slice(6, 8), ['exec', 'resume'])
  assert.equal(resumed.includes('--dangerously-bypass-approvals-and-sandbox'), false)
  assert.deepEqual(resumed.slice(-2), ['thread-id', '-'])
  assert.equal(first.includes('--sandbox'), false)
})

test('Codex 设置只读取当前配置目录的账号姓名和邮箱', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'texloom-codex-account-'))
  try {
    const claims = Buffer.from(JSON.stringify({ name: '研究者', email: 'researcher@example.org', access_token: 'should-not-leak' })).toString('base64url')
    await writeFile(path.join(home, 'auth.json'), JSON.stringify({ tokens: { id_token: `header.${claims}.signature`, access_token: 'secret' } }))
    assert.deepEqual(await readCodexAccount({ CODEX_HOME: home }), { name: '研究者', email: 'researcher@example.org' })
    await writeFile(path.join(home, 'auth.json'), JSON.stringify({ tokens: { id_token: 'invalid' } }))
    assert.equal(await readCodexAccount({ CODEX_HOME: home }), undefined)
  } finally { assert.equal(path.relative(os.tmpdir(), home).startsWith('..'), false); await rm(home, { recursive: true, force: true }) }
})

test('仅接受所选文件的精确唯一替换', () => {
  const proposal = parseSuggestedEdits('{"summary":"已优化","edits":[{"path":"main.tex","old":"\\\\section{旧}","new":"\\\\section{新}"}]}', ['main.tex'])
  assert.ok(proposal)
  const result = applySuggestedEdits(new Map([['main.tex', { text: '\\begin{document}\n\\section{旧}\n\\end{document}' }]]), proposal.edits)
  assert.match(result.get('main.tex') ?? '', /section\{新\}/)
  assert.equal(parseSuggestedEdits('{"summary":"x","edits":[{"path":"../secret","old":"a","new":"b"}]}', ['main.tex']), null)
  assert.throws(() => applySuggestedEdits(new Map([['main.tex', { text: 'old old' }]]), [{ path: 'main.tex', old: 'old', new: 'new' }]), /不唯一/)
})
