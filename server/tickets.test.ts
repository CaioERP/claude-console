import { describe, expect, it } from 'vitest'

import { gitHubRepoOf, mergePrChain, prReposFor } from './tickets'

describe('gitHubRepoOf', () => {
  it('reads owner/name from ssh and https remotes only on GitHub', () => {
    expect(gitHubRepoOf('git@github.com:octocat/app.git')).toBe('octocat/app')
    expect(gitHubRepoOf('https://github.com/octocat/app')).toBe('octocat/app')
    expect(gitHubRepoOf('https://github.com/octocat/app.git')).toBe('octocat/app')
    expect(gitHubRepoOf('https://example.com/x/y.git')).toBeNull()
  })
})

describe('prReposFor', () => {
  const repo = { path: '/home/dev/app', name: 'App', base: null, worktreesDir: '/home/dev/app-worktrees', prRepos: null }

  it('searches every GitHub remote plus the review queue, once each', () => {
    const remotes = new Map([['/home/dev/app', ['git@github.com:octocat/app.git', 'https://github.com/org/app', 'https://example.com/x/y']]])

    expect(prReposFor([repo], remotes, 'org/app')).toEqual(['octocat/app', 'org/app'])
  })

  it('uses the configured list when there is one', () => {
    expect(prReposFor([{ ...repo, prRepos: ['only/this'] }], new Map(), null)).toEqual(['only/this'])
  })
})

describe('mergePrChain', () => {
  const pr = (repo: string, n: number, at: string, title = `ABC-1 Work ${n}`) => ({
    number: n,
    title,
    url: `https://github.com/${repo}/pull/${n}`,
    headRefName: 'feature',
    author: { login: 'octocat' },
    state: 'MERGED',
    createdAt: at,
    statusCheckRollup: [],
  })

  it('orders the chain oldest first, dedupes, and keeps going past a failing repository', () => {
    const out = mergePrChain('ABC-1', [
      { repo: 'octocat/app', prs: [pr('octocat/app', 2, '2026-01-02T00:00:00Z'), pr('octocat/app', 2, '2026-01-02T00:00:00Z')] },
      { repo: 'org/app', prs: [pr('org/app', 9, '2026-01-01T00:00:00Z'), pr('org/app', 10, '2026-01-03T00:00:00Z', 'ABC-10 Other')] },
      { repo: 'rev/app', error: 'HTTP 403' },
    ])

    expect(out.prs.map(p => p.url)).toEqual(['https://github.com/org/app/pull/9', 'https://github.com/octocat/app/pull/2'])
    expect(out.prs[0]).toMatchObject({ repo: 'org/app', author: 'octocat', state: 'merged', ci: 'none' })
    expect(out.prErrors).toEqual([{ repo: 'rev/app', error: 'HTTP 403' }])
  })

  it('matches a key found only in the branch name', () => {
    const out = mergePrChain('ABC-1', [{ repo: 'o/r', prs: [{ ...pr('o/r', 1, '2026-01-01T00:00:00Z', 'Untitled'), headRefName: 'ABC-1-fix' }] }])

    expect(out.prs).toHaveLength(1)
  })
})
