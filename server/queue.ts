import { execFile } from 'node:child_process'

import type { QueuedPr, ReviewQueue } from '../shared/types'
import type { ConsoleConfig } from './config'
import { isSentBy, queueLabel, queueOutcome, ticketOf } from './pure'

const RECENT = 50

const gh = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile('gh', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    )
  })

type RawPr = {
  number: number
  title: string
  url: string
  createdAt: string
  closedAt: string | null
  headRefName: string
  labels: Array<{ name: string }>
  comments?: Array<{ author: { login: string }; body: string }>
}

let login = ''

const toQueued = (pr: RawPr, outcome: QueuedPr['outcome'], reason = ''): QueuedPr => ({
  number: pr.number,
  title: pr.title,
  url: pr.url,
  ticket: ticketOf(pr.title) || ticketOf(pr.headRefName),
  createdAt: Date.parse(pr.createdAt),
  closedAt: pr.closedAt ? Date.parse(pr.closedAt) : null,
  outcome,
  reason,
  labels: pr.labels.map(l => queueLabel(l.name)).filter(l => l.state !== 'other'),
})

// Your pull requests in a reviewer's queue: the ones waiting, and the latest ones
// the reviewer merged or turned down. With a branch suffix, a pull request is
// yours when its branch names you (forwarded by a bot); otherwise when you wrote it.
export const collectReviewQueue = async (queue: NonNullable<ConsoleConfig['reviewQueue']>): Promise<ReviewQueue> => {
  login ||= (await gh(['api', 'user', '--jq', '.login'])).trim()

  const search = queue.branchSuffix ? 'involves:@me' : 'author:@me'
  const fields = 'number,title,url,createdAt,closedAt,headRefName,labels'
  const [open, closed] = await Promise.all([
    gh(['pr', 'list', '-R', queue.repo, '--state', 'open', '--search', search, '--limit', '50', '--json', fields]),
    gh([
      'pr', 'list', '-R', queue.repo, '--state', 'closed', '--search', `${search} sort:updated-desc`,
      '--limit', String(RECENT * 2), '--json', `${fields},comments`,
    ]),
  ])
  const mine = (prs: RawPr[]) =>
    queue.branchSuffix ? prs.filter(pr => isSentBy(pr.headRefName, login, queue.branchSuffix)) : prs

  return {
    name: queue.name,
    repo: queue.repo,
    waiting: mine(JSON.parse(open) as RawPr[])
      .map(pr => toQueued(pr, 'waiting'))
      .sort((a, b) => a.createdAt - b.createdAt),
    recent: mine(JSON.parse(closed) as RawPr[])
      .map(pr => {
        const { outcome, reason } = queueOutcome(pr.comments ?? [], queue.reviewer, queue.mergedPattern)

        return toQueued(pr, outcome, reason)
      })
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      .slice(0, RECENT),
  }
}
