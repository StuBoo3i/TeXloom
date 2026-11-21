import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { agentProfileEnvironment, agentProxyEnvironment, defaultAgentConfig, newAgentProfile, readAgentConfig, writeAgentConfig } from '../server/agent-config.js'
import { claudeEvent, doubaoProvider, geminiEvent } from '../server/agent-cli.js'
import { appendAgentMessage, laneKey, normalizeAgentSession, sharedAgentContext } from '../server/agent-session.js'

test('旧 Codex 项目会话迁移后保留消息和原生线程', () => {
  const session = normalizeAgentSession({ provider: 'codex', threadId: 'old-thread', messages: [{ role: 'user', text: '旧问题', at: '2026-01-01' }] })
  assert.equal(session.schemaVersion, 2)
  assert.equal(session.lanes[laneKey('codex', 'codex-default')].threadId, 'old-thread')
  appendAgentMessage(session, { role: 'assistant', text: '新回答', at: '2026-01-02', provider: 'gemini', profileId: 'gemini-default' })
  assert.equal(session.messages.at(-1)?.id, 2)
})

test('跨服务商共享只包含上次使用之后的其他账号消息', () => {
  const session = normalizeAgentSession(null)
  appendAgentMessage(session, { role: 'assistant', text: 'Codex 先前结论', at: '1', provider: 'codex', profileId: 'codex-default' })
  session.lanes[laneKey('gemini', 'gemini-default')] = { provider: 'gemini', profileId: 'gemini-default', lastSeen: 1, threadId: 'gemini-thread' }
  appendAgentMessage(session, { role: 'assistant', text: 'Claude 新发现', at: '2', provider: 'claude', profileId: 'claude-default' })
  assert.match(sharedAgentContext(session, laneKey('gemini', 'gemini-default'), 4), /Claude 新发现/)
  assert.doesNotMatch(sharedAgentContext(session, laneKey('gemini', 'gemini-default'), 4), /Codex 先前结论/)
})

test('连接中断后的回复保留未完成标记', () => {
  const session = normalizeAgentSession(null)
  appendAgentMessage(session, { role: 'assistant', text: '中途结论', status: 'partial', at: '1', provider: 'codex', profileId: 'codex-default' })
  const restored = normalizeAgentSession(JSON.parse(JSON.stringify(session)))
  assert.equal(restored.messages[0].status, 'partial')
  assert.match(sharedAgentContext(restored, laneKey('gemini', 'gemini-default'), 2), /未完成/)
})

test('独立账号不继承服务进程的 API 密钥', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texloom-agent-profile-'))
  const previous = process.env.ANTHROPIC_API_KEY
  try {
    process.env.ANTHROPIC_API_KEY = 'should-not-pass'
    const profile = newAgentProfile('claude', '账号二')
    const config = defaultAgentConfig(); config.profiles.push(profile)
    await writeAgentConfig(root, config)
    assert.equal((await readAgentConfig(root)).profiles.at(-1)?.label, '账号二')
    const env = await agentProfileEnvironment(root, profile)
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
    assert.match(env.CLAUDE_CONFIG_DIR || '', /agent-accounts/)
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('Agent CLI 默认不限制文件修改与编译任务的运行时间', () => {
  assert.ok(defaultAgentConfig().profiles.every(profile => profile.timeoutSeconds === 0))
  assert.equal(newAgentProfile('codex', '另一个账号').timeoutSeconds, 0)
})

test('Agent CLI 使用 Windows 系统代理，但保留显式代理设置', () => {
  const proxy = 'http://127.0.0.1:7890'
  assert.equal(agentProxyEnvironment({}, proxy).HTTPS_PROXY, proxy)
  assert.equal(agentProxyEnvironment({ HTTPS_PROXY: 'http://custom:8080' }, proxy).HTTPS_PROXY, 'http://custom:8080')
  assert.equal(agentProxyEnvironment({ ALL_PROXY: 'socks5://custom:1080' }, proxy).HTTPS_PROXY, undefined)
})

test('Claude 与 Gemini 事件正确提取回答', () => {
  assert.deepEqual(claudeEvent({ type: 'result', session_id: 'claude-thread', result: '最终答案' }), { type: 'text', text: '最终答案' })
  assert.deepEqual(geminiEvent({ type: 'init', session_id: 'gemini-thread' }), { type: 'thread', threadId: 'gemini-thread' })
  assert.deepEqual(geminiEvent({ type: 'result', response: '摘要' }), { type: 'text', text: '摘要' })
})

test('Windows npm 命令包装器可启动豆包 CLI，并清理临时请求', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texloom-doubao-shim-'))
  try {
    await writeFile(path.join(root, 'doubao.cmd'), '@echo off\r\nif "%1"=="--version" (echo doubao-test & exit /b 0)\r\nif "%1"=="-p" (echo response-ok & exit /b 0)\r\nexit /b 1\r\n')
    const env = { ...process.env, PATH: root + ';' + (process.env.PATH || '') }
    assert.equal((await doubaoProvider.status(env)).installed, true)
    const result = await doubaoProvider.run({ cwd: root, prompt: '测试任务', mode: 'review', env, model: '', effort: 'auto', timeoutSeconds: 30, onEvent: () => {} })
    assert.equal(result.code, 0)
    assert.match(result.text, /response-ok/)
    await assert.rejects(readFile(path.join(root, '.texloom-agent-request.txt')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
