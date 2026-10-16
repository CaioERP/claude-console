import { describe, expect, it } from 'vitest'

import { isTicketKey, planWorktree } from './startwork'

const repo = {
  path: '/home/dev/app',
  name: 'App',
  base: { remote: 'upstream', branch: 'main' },
  worktreesDir: '/home/dev/app-worktrees',
  prRepos: null,
}
const empty = { worktrees: [{ path: '/home/dev/app', branch: 'main' }], localBranches: ['main'], forkBranches: [], dirExists: false }

describe('isTicketKey', () => {
  it('accepts only plain ticket keys', () => {
    expect(isTicketKey('ABC-1')).toBe(true)

    for (const bad of ['abc-1', ' ABC-1', 'ABC-1;rm', 'ABC', '-1', 'ABC-1\n']) expect(isTicketKey(bad)).toBe(false)
  })
})

describe('planWorktree', () => {
  it('reuses a checkout already on the branch, wherever it is', () => {
    const state = { ...empty, worktrees: [{ path: '/home/dev/app', branch: 'ABC-1' }], localBranches: ['ABC-1'] }

    expect(planWorktree('ABC-1', repo, state)).toEqual({ kind: 'reuse', path: '/home/dev/app' })
  })

  it('checks out an existing local branch without resetting it', () => {
    expect(planWorktree('ABC-1', repo, { ...empty, localBranches: ['main', 'ABC-1'] })).toEqual({
      kind: 'create',
      path: '/home/dev/app-worktrees/ABC-1',
      from: 'branch',
      commands: [['git', '-C', '/home/dev/app', 'worktree', 'add', '/home/dev/app-worktrees/ABC-1', 'ABC-1']],
    })
  })

  it('continues pushed work from the fork', () => {
    expect(planWorktree('ABC-1', repo, { ...empty, forkBranches: ['ABC-1'] })).toMatchObject({
      from: 'fork',
      commands: [
        ['git', '-C', '/home/dev/app', 'worktree', 'add', '--no-track', '-b', 'ABC-1', '/home/dev/app-worktrees/ABC-1', 'origin/ABC-1'],
      ],
    })
  })

  it('branches fresh from the base, fetching it first', () => {
    expect(planWorktree('ABC-1', repo, empty)).toMatchObject({
      from: 'base',
      commands: [
        ['git', '-C', '/home/dev/app', 'fetch', 'upstream', 'main'],
        ['git', '-C', '/home/dev/app', 'worktree', 'add', '--no-track', '-b', 'ABC-1', '/home/dev/app-worktrees/ABC-1', 'upstream/main'],
      ],
    })
  })

  it('refuses a folder that exists but is not a worktree', () => {
    expect(planWorktree('ABC-1', repo, { ...empty, dirExists: true }).kind).toBe('blocked')
  })

  it('refuses a repository without a base', () => {
    expect(planWorktree('ABC-1', { ...repo, base: null }, empty).kind).toBe('blocked')
  })
})
