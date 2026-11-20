import assert from 'node:assert/strict'
import test from 'node:test'
import { githubRemote, safeBranch } from '../server/git-collab.js'

test('GitHub remote accepts private repository HTTPS and SSH addresses without credentials', () => {
  assert.deepEqual(githubRemote('https://github.com/owner/private-repo.git'), { url: 'https://github.com/owner/private-repo.git', owner: 'owner', repo: 'private-repo' })
  assert.deepEqual(githubRemote('git@github.com:owner/private-repo.git'), { url: 'git@github.com:owner/private-repo.git', owner: 'owner', repo: 'private-repo' })
  for (const value of ['https://user:token@github.com/owner/repo', 'https://github.com.evil.test/owner/repo', 'file:///tmp/repo', 'https://github.com/owner/../repo', 'https://github.com/owner/repo?x=1']) assert.throws(() => githubRemote(value))
})

test('branch names reject ref syntax and the reserved review branch', () => {
  assert.equal(safeBranch('feature/alice/chapter-1'), 'feature/alice/chapter-1')
  for (const value of ['../main', 'feature//topic', 'feature/x.lock', 'texloom-reviews', '-force', 'main^{}']) assert.throws(() => safeBranch(value))
})
