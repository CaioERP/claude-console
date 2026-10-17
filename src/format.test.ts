import { describe, expect, it } from 'vitest'

import type { PullRequest, RecentPr, Session } from '../shared/types'
import { blend, briefingPrs, bytesLabel, summaryParagraphs, elapsedLabel, greeting, memoryKey, memoryLinks, prBelongsTo, mentions, orderStatuses, quartileScale, resumeCommand, sessionMatches, spinnerFrame, verbFor, worktreeOf } from './format'

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  name: 'BaseEditPage sidebar position markup',
  isAutoTitle: false,
  responses: 12,
  recap: '',
  recapAt: 0,
  prUrls: [],
  branch: 'ABC-1001',
  model: 'Opus 5.5',
  top: '/repo/.claude/worktrees/worktree-ABC-1001',
  dir: '/repo/.claude/worktrees/worktree-ABC-1001/workspaces/web-workspace/modules/web-app',
  resumeDir: '/repo/.claude/worktrees/worktree-ABC-1001',
  ctx: 43,
  h5: null,
  h5Reset: '',
  h5ResetAt: null,
  d7: null,
  d7ResetAt: null,
  cost: null,
  seenAt: 0,
  isLive: true,
  isRunning: true,
  runStatus: 'idle',
  runSince: 0,
  remoteUrl: '',
  ...over,
})

describe('worktreeOf', () => {
  it('names the worktree and shortens the folder inside it', () => {
    expect(worktreeOf(session())).toEqual({ name: 'worktree-ABC-1001', inside: 'workspaces/…/web-app' })
  })

  it('leaves the inside empty at the worktree root and outside it', () => {
    expect(worktreeOf(session({ dir: '/repo/.claude/worktrees/worktree-ABC-1001' })).inside).toBe('')
    expect(worktreeOf(session({ dir: '/elsewhere' })).inside).toBe('')
    expect(worktreeOf(session({ top: '' }))).toEqual({ name: '', inside: '' })
  })
})

describe('sessionMatches', () => {
  it('matches name, branch, worktree and model, ignoring case', () => {
    expect(sessionMatches(session(), 'sidebar')).toBe(true)
    expect(sessionMatches(session(), 'abc-1001')).toBe(true)
    expect(sessionMatches(session(), 'web-app')).toBe(true)
    expect(sessionMatches(session(), 'opus')).toBe(true)
    expect(sessionMatches(session(), '  ')).toBe(true)
    expect(sessionMatches(session(), 'devcon')).toBe(false)
  })
})

describe('resumeCommand', () => {
  it('changes into the folder the session started in and resumes it', () => {
    expect(resumeCommand(session())).toBe('cd /repo/.claude/worktrees/worktree-ABC-1001 && claude --resume s1')
  })

  it('quotes folders the shell would split', () => {
    expect(resumeCommand(session({ resumeDir: "/tmp/my dir/it's" }))).toBe(
      "cd '/tmp/my dir/it'\\''s' && claude --resume s1",
    )
  })
})

describe('mentions', () => {
  it('finds a Jira key inside branch names and titles', () => {
    expect(mentions('ABC-1077', 'ABC-1077')).toBe(true)
    expect(mentions('release-1.x-backport-ABC-1077', 'ABC-1077')).toBe(true)
    expect(mentions('ABC-1001 ABC-1042 Make the editor sidebar push', 'ABC-1042')).toBe(true)
  })

  it('does not match a longer key or a prefix', () => {
    expect(mentions('ABC-10771', 'ABC-1077')).toBe(false)
    expect(mentions('XABC-1077', 'ABC-1077')).toBe(false)
  })
})

describe('spinner', () => {
  it('ping-pongs through the Claude Code glyphs', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(spinnerFrame).join('')).toBe('·✢✳✶✻✽✻✶✳✢·')
  })

  it('keeps one verb for a stretch of work and changes it for the next', () => {
    expect(verbFor('s1', 1000)).toBe(verbFor('s1', 1000))
    expect(new Set(Array.from({ length: 20 }, (_, i) => verbFor('s1', i))).size).toBeGreaterThan(1)
  })

  it('formats elapsed time the way Claude Code does', () => {
    expect(elapsedLabel(4_000)).toBe('4s')
    expect(elapsedLabel(75_000)).toBe('1m 15s')
    expect(elapsedLabel(-5)).toBe('0s')
  })
})

describe('orderStatuses', () => {
  it('orders known statuses by the usual workflow and the rest by category', () => {
    expect(
      orderStatuses([
        { status: 'In Review', category: 'indeterminate' },
        { status: 'Waiting on Customer', category: 'indeterminate' },
        { status: 'In Peer Review', category: 'indeterminate' },
        { status: 'In Progress', category: 'indeterminate' },
        { status: 'Parked', category: 'new' },
        { status: 'In Development', category: 'indeterminate' },
        { status: 'In Progress', category: 'indeterminate' },
        { status: 'To Do', category: 'new' },
      ]),
    ).toEqual(['To Do', 'In Progress', 'In Development', 'In Peer Review', 'In Review', 'Parked', 'Waiting on Customer'])
  })
})

describe('heatmap scale', () => {
  it('splits active days into quartiles and leaves empty days at zero', () => {
    const scale = quartileScale([0, 1, 2, 3, 4, 5, 6, 7, 8, 100])

    expect([0, 1, 3, 5, 7, 8, 100].map(scale)).toEqual([0, 1, 1, 2, 3, 4, 4])
  })

  it('blends both sources so neither drowns the other', () => {
    const mixed = blend([0, 10, 0, 10], [0, 0, 5000, 5000])

    expect(mixed[0]).toBe(0)
    expect(mixed[1]).toBeCloseTo(mixed[2]!)
    expect(mixed[3]).toBeGreaterThan(mixed[1]!)
  })
})

describe('prBelongsTo', () => {
  const pr = { url: 'https://github.com/i/r/pull/604', branch: 'ABC-1001', title: 'ABC-1001 Make the sidebar push' }

  it('links by pr-link, branch, or the ticket in the branch or worktree name', () => {
    expect(prBelongsTo(pr, session({ branch: '', prUrls: [pr.url], top: '/repo', dir: '/repo' }))).toBe(true)
    expect(prBelongsTo(pr, session({ branch: 'ABC-1001', prUrls: [] }))).toBe(true)
    expect(prBelongsTo(pr, session({ branch: '', prUrls: [] }))).toBe(true)
  })

  it('does not link a session on master with no link to the pull request', () => {
    expect(prBelongsTo(pr, session({ branch: 'master', prUrls: [], top: '/repo', dir: '/repo' }))).toBe(false)
  })
})

describe('memory links', () => {
  it('treats dashes and underscores, and a .md suffix, as the same name', () => {
    expect(memoryKey('feedback_commit_style.md')).toBe(memoryKey('feedback-commit-style'))
    expect(memoryKey('PR-Target')).toBe('pr-target')
  })

  it('lists the [[links]] of a note', () => {
    expect(memoryLinks('See [[a-note]] and [[b_note]].')).toEqual(['a-note', 'b_note'])
  })
})

describe('greeting', () => {
  const at = (hour: number) => new Date(2026, 9, 15, hour, 30).getTime()

  it('follows the local hour, with the small hours as evening', () => {
    expect([1, 4, 5, 11, 12, 17, 18, 23].map(h => greeting(at(h)))).toEqual([
      'Good evening',
      'Good evening',
      'Good morning',
      'Good morning',
      'Good afternoon',
      'Good afternoon',
      'Good evening',
      'Good evening',
    ])
  })
})

describe('briefingPrs', () => {
  const now = new Date(2026, 9, 15, 10).getTime()
  const today = new Date(2026, 9, 15, 8).getTime()
  const yesterday = new Date(2026, 9, 14, 15).getTime()
  const lastWeek = new Date(2026, 9, 8, 9).getTime()
  const recent = (number: number, state: RecentPr['state'], createdAt: number, closedAt: number | null): RecentPr => ({
    repo: 'acme/acme-app',
    number,
    title: `PR ${number}`,
    url: `https://github.com/x/${number}`,
    state,
    createdAt,
    closedAt,
    updatedAt: closedAt ?? createdAt,
  })

  it('names what happened to each pull request since yesterday', () => {
    const prs = briefingPrs(
      [
        recent(1, 'open', today, null),
        recent(2, 'merged', lastWeek, yesterday),
        recent(3, 'closed', yesterday, today),
        recent(4, 'open', lastWeek, null),
        recent(5, 'merged', lastWeek, lastWeek),
      ],
      [],
      null,
      now,
    )

    expect(prs.map(pr => [pr.number, pr.event, pr.day])).toEqual([
      [1, 'opened', 'today'],
      [3, 'closed', 'today'],
      [2, 'merged', 'yesterday'],
      [4, 'open', null],
    ])
  })

  it('keeps one line per URL and carries the CI state of open pull requests', () => {
    const open = { url: 'https://github.com/x/1', number: 1, title: 'PR 1', repo: 'r', updatedAt: today, ci: 'failing' }
    const prs = briefingPrs([recent(1, 'open', today, null)], [open as PullRequest], null, now)

    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({ event: 'opened', ci: 'failing' })
  })
})

describe('summaryParagraphs', () => {
  const prs = new Map([[4205, 'https://github.com/o/r/pull/4205']])
  const tickets = new Map([['ABC-1', 'https://example.atlassian.net/browse/ABC-1']])

  it('splits paragraphs and links only known pull requests and tickets', () => {
    expect(summaryParagraphs('Shipped #4205 for ABC-1, not #9 or XYZ-2.\n\n**Next:** review', prs, tickets)).toEqual([
      [
        { kind: 'text', text: 'Shipped ' },
        { kind: 'link', text: '#4205', url: 'https://github.com/o/r/pull/4205' },
        { kind: 'text', text: ' for ' },
        { kind: 'link', text: 'ABC-1', url: 'https://example.atlassian.net/browse/ABC-1' },
        { kind: 'text', text: ', not ' },
        { kind: 'text', text: '#9' },
        { kind: 'text', text: ' or ' },
        { kind: 'text', text: 'XYZ-2' },
        { kind: 'text', text: '.' },
      ],
      [{ kind: 'bold', children: [{ kind: 'text', text: 'Next:' }] }, { kind: 'text', text: ' review' }],
    ])
  })

  it('links inside bold and never treats markup as anything but text', () => {
    expect(summaryParagraphs('**ABC-1 moved**', prs, tickets)[0]).toEqual([
      { kind: 'bold', children: [{ kind: 'link', text: 'ABC-1', url: 'https://example.atlassian.net/browse/ABC-1' }, { kind: 'text', text: ' moved' }] },
    ])
    expect(summaryParagraphs('<img src=x onerror=alert(1)>', prs, tickets)).toEqual([[{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]])
  })
})

describe('bytesLabel', () => {
  it('reads like a disk size', () => {
    expect(bytesLabel(79_457_043_349)).toBe('79.5 GB')
    expect(bytesLabel(514_941_128_704)).toBe('515 GB')
    expect(bytesLabel(4_908_593)).toBe('4.9 MB')
    expect(bytesLabel(512)).toBe('512 B')
  })
})
