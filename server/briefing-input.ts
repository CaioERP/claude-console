import { createHash } from 'node:crypto'

import type { Briefing, JiraIssue, PullRequest, RecentPr, ReviewQueue } from '../shared/types'
import { briefingPrs } from '../src/format'

const MAX_SESSIONS = 25
const MAX_PRS = 30
const MAX_RECAP = 400

const localDate = (ms: number) => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const clock = (ms: number) => {
  const d = new Date(ms)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// What the daily-briefing skill writes from: the last working day's sessions,
// the pull requests that moved since yesterday or are still open, the review
// queue, and the tickets in progress. Only stable facts go in, so the input,
// and its hash, change only when something worth a new summary happened.
export const briefingInput = (
  data: {
    briefing: Briefing | null
    recentPrs: RecentPr[]
    prs: PullRequest[]
    queue: ReviewQueue | null
    jira: JiraIssue[]
  },
  language: string,
  now: number,
) => {
  const sessions = (data.briefing?.sessions ?? [])
    .filter(s => s.responses > 0)
    .slice(0, MAX_SESSIONS)
    .map(s => ({
      title: s.title || 'Untitled session',
      worktree: s.worktree,
      branch: s.branch,
      time: `${clock(s.firstAt)}-${clock(s.lastAt)}`,
      responses: s.responses,
      recap: cut(s.recap, MAX_RECAP),
    }))
  const pullRequests = briefingPrs(data.recentPrs, data.prs, data.queue, now)
    .slice(0, MAX_PRS)
    .map(pr => ({ number: pr.number, title: pr.title, repo: pr.repo, event: pr.event, day: pr.day ?? 'earlier' }))
  const tickets = data.jira
    .filter(issue => issue.statusCategory === 'indeterminate')
    .map(issue => ({ key: issue.key, summary: issue.summary, status: issue.status }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return {
    today: localDate(now),
    language,
    lastWorkDay: data.briefing ? { date: data.briefing.day, isYesterday: data.briefing.isYesterday } : null,
    reviewer: data.queue?.name ?? '',
    sessions,
    pullRequests,
    tickets,
  }
}

export type BriefingInput = ReturnType<typeof briefingInput>

export const inputHash = (input: BriefingInput) => createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)
