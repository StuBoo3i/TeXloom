import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type ReviewThread = { id: string; file: string; line: number; column: number; offset: number; original: string; body: string; author?: string; proposed?: string; type: 'comment' | 'suggestion'; status: 'open' | 'resolved' | 'accepted' | 'rejected'; createdAt: string; replies: { id: string; body: string; author?: string; createdAt: string }[]; target?: { branch: string; commit: string; blob: string } }
export type ReviewEvent = { schema: 1; id: string; threadId: string; at: string; actor: string; kind: 'thread.created' | 'reply.added' | 'thread.status'; thread?: ReviewThread; reply?: ReviewThread['replies'][number]; status?: ReviewThread['status'] }

const uuid = /^[0-9a-f-]{36}$/i
const safePath = (value: string) => typeof value === 'string' && value.length <= 300 && !/[\\:\x00-\x1f]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git' && part !== '.openleaf')

export function validateReviewEvent(value: unknown): ReviewEvent {
  const item = value as Partial<ReviewEvent> | null
  if (!item || item.schema !== 1 || !uuid.test(item.id ?? '') || !uuid.test(item.threadId ?? '') || !Number.isFinite(Date.parse(item.at ?? '')) || typeof item.actor !== 'string' || item.actor.length > 100 || /[\x00-\x1f]/.test(item.actor)) throw new Error('审阅事件元数据无效')
  if (item.kind === 'thread.created') {
    const thread = item.thread
    if (!thread || thread.id !== item.threadId || !safePath(thread.file) || !Number.isInteger(thread.line) || thread.line < 1 || !Number.isInteger(thread.column) || thread.column < 1 || !Number.isInteger(thread.offset) || thread.offset < 0 || !['comment', 'suggestion'].includes(thread.type) || !['open', 'resolved', 'accepted', 'rejected'].includes(thread.status) || typeof thread.body !== 'string' || thread.body.length > 4000 || typeof thread.original !== 'string' || thread.original.length > 20000 || thread.author !== undefined && (typeof thread.author !== 'string' || thread.author.length > 100) || thread.proposed !== undefined && (typeof thread.proposed !== 'string' || thread.proposed.length > 20000) || !Array.isArray(thread.replies) || thread.replies.length > 1000 || thread.replies.some(reply => !uuid.test(reply.id) || typeof reply.body !== 'string' || reply.body.length > 4000 || reply.author !== undefined && (typeof reply.author !== 'string' || reply.author.length > 100) || !Number.isFinite(Date.parse(reply.createdAt)))) throw new Error('审阅线程无效')
  } else if (item.kind === 'reply.added') {
    if (!item.reply || !uuid.test(item.reply.id) || typeof item.reply.body !== 'string' || item.reply.body.length > 4000 || item.reply.author !== undefined && (typeof item.reply.author !== 'string' || item.reply.author.length > 100) || !Number.isFinite(Date.parse(item.reply.createdAt))) throw new Error('审阅回复无效')
  } else if (item.kind === 'thread.status') {
    if (!['open', 'resolved', 'accepted', 'rejected'].includes(item.status ?? '')) throw new Error('审阅状态无效')
  } else throw new Error('审阅事件类型无效')
  return item as ReviewEvent
}

export function foldReviewEvents(events: ReviewEvent[]): ReviewThread[] {
  const threads = new Map<string, ReviewThread>()
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === 'thread.created' ? -1 : 0) - (b.kind === 'thread.created' ? -1 : 0) || a.id.localeCompare(b.id))) {
    if (event.kind === 'thread.created' && event.thread && !threads.has(event.threadId)) threads.set(event.threadId, { ...structuredClone(event.thread), author: event.thread.author || event.actor })
    const thread = threads.get(event.threadId)
    if (!thread) continue
    if (event.kind === 'reply.added' && event.reply && !thread.replies.some(reply => reply.id === event.reply?.id)) thread.replies.push({ ...event.reply, author: event.reply.author || event.actor })
    if (event.kind === 'thread.status' && event.status) thread.status = event.status
  }
  return [...threads.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function makeReviewEvent(kind: ReviewEvent['kind'], threadId: string, actor: string, data: Pick<ReviewEvent, 'thread' | 'reply' | 'status'>): ReviewEvent {
  return validateReviewEvent({ schema: 1, id: randomUUID(), threadId, at: new Date().toISOString(), actor: actor.slice(0, 100), kind, ...data })
}

export async function writeReviewEvent(directory: string, event: ReviewEvent): Promise<void> {
  validateReviewEvent(event)
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${event.id}.json`)
  await writeFile(`${file}.tmp`, JSON.stringify(event), { flag: 'wx' })
  await rename(`${file}.tmp`, file)
}

export async function readReviewEvents(directory: string): Promise<ReviewEvent[]> {
  let files: string[]
  try { files = await readdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  if (files.some(file => file.endsWith('.json') && !uuid.test(path.basename(file, '.json')))) throw new Error('审阅事件文件名无效')
  const names = files.filter(file => uuid.test(path.basename(file, '.json')) && file.endsWith('.json'))
  if (names.length > 20_000) throw new Error('审阅事件数量超过上限')
  const events: ReviewEvent[] = []
  for (const name of names) {
    const file = path.join(directory, name)
    const details = await lstat(file)
    if (!details.isFile() || details.size > 64 * 1024) throw new Error(`审阅事件文件无效：${name}`)
    const item = validateReviewEvent(JSON.parse(await readFile(file, 'utf8')))
    if (`${item.id}.json` !== name) throw new Error(`审阅事件 ID 与文件名不一致：${name}`)
    events.push(item)
  }
  return events
}
