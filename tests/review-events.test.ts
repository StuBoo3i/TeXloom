import assert from 'node:assert/strict'
import test from 'node:test'
import { foldReviewEvents, makeReviewEvent, validateReviewEvent, type ReviewThread } from '../server/review-events.js'

test('review events reconstruct a thread without duplicating replies', () => {
  const thread: ReviewThread = { id: '11111111-1111-4111-8111-111111111111', file: 'chapter/main.tex', line: 4, column: 2, offset: 20, original: '旧文', body: '建议修改', proposed: '新文', type: 'suggestion', status: 'open', createdAt: '2026-11-20T00:00:00.000Z', replies: [] }
  const created = makeReviewEvent('thread.created', thread.id, 'Alice', { thread })
  const reply = { id: '22222222-2222-4222-8222-222222222222', body: '已检查', createdAt: '2026-11-20T00:00:01.000Z' }
  const answered = makeReviewEvent('reply.added', thread.id, 'Bob', { reply })
  const resolved = makeReviewEvent('thread.status', thread.id, 'Alice', { status: 'resolved' })
  created.at = '2026-11-20T00:00:00.000Z'; answered.at = '2026-11-20T00:00:01.000Z'; resolved.at = '2026-11-20T00:00:02.000Z'
  const result = foldReviewEvents([resolved, answered, created, answered])
  assert.equal(result.length, 1)
  assert.equal(result[0].status, 'resolved')
  assert.deepEqual(result[0].replies, [{ ...reply, author: 'Bob' }])
  assert.throws(() => validateReviewEvent({ ...created, thread: { ...thread, file: '../../outside.tex' } }))
})
