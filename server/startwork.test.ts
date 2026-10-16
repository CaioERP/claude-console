import { describe, expect, it } from 'vitest'

import { executeStart, isTicketKey, planWorktree, startPrompt } from './startwork'

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

describe('executeStart', () => {
  const a = { ...repo, name: 'A', path: '/home/dev/a', worktreesDir: '/home/dev/a-worktrees' }
  const b = { ...repo, name: 'B', path: '/home/dev/b', worktreesDir: '/home/dev/b-worktrees' }

  it('isolates a failing fetch to its repository', async () => {
    const opened: string[] = []
    const results = await executeStart('ABC-1', [a, b], {
      readState: async () => empty,
      run: async argv => {
        if (argv.includes('/home/dev/a') && argv.includes('fetch')) throw new Error('offline')
      },
      open: async dir => {
        opened.push(dir)
      },
      prompt: '/start-ticket ABC-1',
    })

    expect(results.map(r => [r.repo, r.ok])).toEqual([
      ['A', false],
      ['B', true],
    ])
    expect(results[0]!.error).toContain('offline')
    expect(opened).toEqual(['/home/dev/b-worktrees/ABC-1'])
  })

  it('opens a session in a reused checkout without running git', async () => {
    const ran: string[][] = []
    const opened: [string, string][] = []
    const results = await executeStart('ABC-1', [a], {
      readState: async () => ({ ...empty, worktrees: [{ path: '/home/dev/a', branch: 'ABC-1' }] }),
      run: async argv => {
        ran.push(argv)
      },
      open: async (dir, prompt) => {
        opened.push([dir, prompt])
      },
      prompt: '/start-ticket ABC-1',
    })

    expect(ran).toEqual([])
    expect(opened).toEqual([['/home/dev/a', '/start-ticket ABC-1']])
    expect(results).toEqual([{ repo: 'A', path: '/home/dev/a', plan: 'reuse', ok: true }])
  })

  it('opens nothing for a blocked repository', async () => {
    const opened: string[] = []
    const results = await executeStart('ABC-1', [a], {
      readState: async () => ({ ...empty, dirExists: true }),
      run: async () => undefined,
      open: async dir => {
        opened.push(dir)
      },
      prompt: '',
    })

    expect(results[0]).toMatchObject({ repo: 'A', plan: 'blocked', ok: false })
    expect(opened).toEqual([])
  })
})

describe('startPrompt', () => {
  it('fills the key into the prompt', () => {
    expect(startPrompt('/start-ticket {key} now {key}', 'ABC-1')).toBe('/start-ticket ABC-1 now ABC-1')
  })
})
