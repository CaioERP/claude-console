import { describe, expect, it } from 'vitest'

import type { Briefing, JiraIssue, RecentPr } from '../shared/types'
import { briefingInput, inputHash } from './briefing-input'

const now = new Date(2026, 9, 16, 9).getTime()
const yesterday = new Date(2026, 9, 15, 14).getTime()

const briefing: Briefing = {
  day: '2026-10-15',
  isYesterday: true,
  todaySessions: 1,
  sessions: [
    { id: 'a', title: 'Fix the build', worktree: 'wt-1', branch: 'ABC-1', responses: 12, firstAt: yesterday, lastAt: yesterday + 3_600_000, recap: 'CI is green.' },
    { id: 'b', title: '', worktree: 'main', branch: 'main', responses: 0, firstAt: yesterday, lastAt: yesterday, recap: '' },
  ],
}
const pr = (state: RecentPr['state']): RecentPr => ({
  repo: 'acme/app', number: 7, title: 'ABC-1 Fix the build', url: 'https://github.com/acme/app/pull/7',
  state, createdAt: yesterday, closedAt: state === 'open' ? null : yesterday, updatedAt: yesterday,
})
const ticket: JiraIssue = {
  key: 'ABC-1', summary: 'Fix the build', status: 'In Review', statusCategory: 'indeterminate', type: 'Task',
  priority: '', updatedAt: yesterday, parentKey: '', parentSummary: '', url: 'https://example.atlassian.net/browse/ABC-1',
}

describe('briefingInput', () => {
  it('keeps the sessions with work, the moved pull requests, and the tickets in progress', () => {
    const input = briefingInput({ briefing, recentPrs: [pr('merged')], prs: [], queue: null, jira: [ticket] }, 'English', now)

    expect(input.sessions).toEqual([{ title: 'Fix the build', worktree: 'wt-1', branch: 'ABC-1', time: '14:00-15:00', responses: 12, recap: 'CI is green.' }])
    expect(input.pullRequests).toEqual([{ number: 7, title: 'ABC-1 Fix the build', repo: 'acme/app', event: 'merged', day: 'yesterday' }])
    expect(input.tickets).toEqual([{ key: 'ABC-1', summary: 'Fix the build', status: 'In Review' }])
  })

  it('hashes the same facts the same way, and new facts differently', () => {
    const base = { briefing, recentPrs: [pr('open')], prs: [], queue: null, jira: [ticket] }
    const hash = inputHash(briefingInput(base, 'English', now))

    expect(inputHash(briefingInput(base, 'English', now + 60_000))).toBe(hash)
    expect(inputHash(briefingInput({ ...base, recentPrs: [pr('merged')] }, 'English', now))).not.toBe(hash)
    expect(inputHash(briefingInput(base, 'English', now + 86_400_000))).not.toBe(hash)
  })
})
