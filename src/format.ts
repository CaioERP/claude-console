import type { ReviewQueue, CiState, PullRequest, RecentPr, Session, Snapshot } from '../shared/types'

export const ago = (ms: number, now: number) => {
  if (!ms) return 'never'

  const s = Math.max(0, Math.round((now - ms) / 1000))

  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`

  return `${Math.floor(s / 86_400)}d ago`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export const headline = (s: Snapshot): string => {
  const active = s.worktrees.filter(w => w.activity === 'active').length
  const servers = s.worktrees.filter(w => w.devServerPort).length
  const failing = s.prs.filter(p => p.ci === 'failing').length
  const running = s.prs.filter(p => p.ci === 'running').length
  const live = s.sessions.filter(x => x.isLive).length
  const parts = [
    `${plural(active, 'worktree')} active${servers ? `, ${plural(servers, 'dev server')} running` : ''}.`,
    s.prs.length === 0
      ? 'No open pull requests.'
      : `${plural(s.prs.length, 'open pull request')}${
          failing ? `, ${failing} failing CI` : running ? `, ${running} still running CI` : ', nothing failing'
        }.`,
    live ? `${plural(live, 'Claude session')} running.` : 'No Claude session running.',
  ]

  return parts.join(' ')
}

export const compact = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`

  return String(n)
}

export const until = (ms: number, now: number) => {
  const minutes = Math.max(0, Math.round((ms - now) / 60_000))

  if (minutes < 60) return `in ${minutes}m`

  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `in ${hours}h ${minutes % 60}m` : `in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

// Where a session runs: its worktree's folder name, and the folder inside the
// worktree it was started from, shortened to its first and last parts.
export const worktreeOf = (session: Pick<Session, 'top' | 'dir'>) => {
  if (!session.top) return { name: '', inside: '' }

  const name = session.top.split('/').filter(Boolean).pop() ?? session.top
  const rest = session.dir.startsWith(session.top) ? session.dir.slice(session.top.length).replace(/^\//, '') : ''
  const parts = rest.split('/').filter(Boolean)
  const inside = parts.length > 2 ? `${parts[0]}/…/${parts[parts.length - 1]}` : parts.join('/')

  return { name, inside }
}

export const sessionMatches = (session: Session, query: string) => {
  const q = query.trim().toLowerCase()

  if (!q) return true

  const { name, inside } = worktreeOf(session)

  return [session.name, session.branch, session.model, name, inside, session.dir]
    .join(' ')
    .toLowerCase()
    .includes(q)
}

const shellQuote = (value: string) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`)

export const resumeCommand = (session: Pick<Session, 'id' | 'resumeDir'>) =>
  `cd ${shellQuote(session.resumeDir)} && claude --resume ${session.id}`

// Whether a branch name or title refers to a Jira key, so ABC-1 never matches
// ABC-10 or XABC-1.
export const mentions = (text: string, key: string) =>
  new RegExp(`(^|[^A-Z0-9])${key}($|[^0-9])`, 'i').test(text)

const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽']

// Claude Code's thinking glyph at a given tick, running up then back down.
export const spinnerFrame = (tick: number) => {
  const cycle = GLYPHS.length * 2 - 2
  const at = tick % cycle

  return GLYPHS[at < GLYPHS.length ? at : cycle - at]!
}

const VERBS = [
  'Thinking', 'Pondering', 'Cogitating', 'Deliberating', 'Ruminating', 'Brewing', 'Crafting', 'Conjuring',
  'Computing', 'Noodling', 'Mulling', 'Percolating', 'Synthesizing', 'Tinkering', 'Whirring', 'Working',
]

// One verb per stretch of work: the same session and start time always pick
// the same verb, and the next stretch most likely picks another.
export const verbFor = (sessionId: string, since: number) => {
  let hash = since

  for (const char of sessionId) hash = (hash * 31 + char.charCodeAt(0)) | 0

  return VERBS[Math.abs(hash) % VERBS.length]!
}

export const elapsedLabel = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const WORKFLOW = [
  'open', 'to do', 'backlog', 'selected for development', 'ready for development', 'in progress', 'in development',
  'code review', 'in peer review', 'in review', 'ready for qa', 'in qa', 'testing', 'verified', 'ready to release',
]
const CATEGORY_RANK: Record<string, number> = { new: 0, indeterminate: 1, done: 2 }

// Statuses in workflow order: common Jira statuses by their place in the flow,
// any other by its Jira category, then by name.
export const orderStatuses = (statuses: Array<{ status: string; category: string }>) => {
  const rank = ({ status, category }: { status: string; category: string }) => {
    const at = WORKFLOW.indexOf(status.toLowerCase())

    return at >= 0 ? at : WORKFLOW.length + (CATEGORY_RANK[category] ?? 1) * 100
  }

  return [...new Map(statuses.map(s => [s.status, s])).values()]
    .sort((a, b) => rank(a) - rank(b) || a.status.localeCompare(b.status))
    .map(s => s.status)
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4

// GitHub's scale: empty days are level 0, and the days with any activity split
// into quartiles, so one huge day never washes the rest out.
export const quartileScale = (values: number[]) => {
  const active = values.filter(v => v > 0).sort((a, b) => a - b)
  const at = (q: number) => active[Math.min(active.length - 1, Math.floor(q * active.length))] ?? 0
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)]

  return (value: number): HeatLevel => (value <= 0 ? 0 : value <= q1 ? 1 : value <= q2 ? 2 : value <= q3 ? 3 : 4)
}

// Both sources on one scale: each day's GitHub and Claude counts are divided by
// their own 90th percentile (capped at 1) and averaged, so neither drowns the
// other however different their magnitudes are.
export const blend = (github: number[], claude: number[]) => {
  const p90 = (values: number[]) => {
    const active = values.filter(v => v > 0).sort((a, b) => a - b)

    return active[Math.floor(0.9 * (active.length - 1))] || 1
  }
  const [g, c] = [p90(github), p90(claude)]

  return github.map((value, i) => (Math.min(1, value / g) + Math.min(1, (claude[i] ?? 0) / c)) / 2)
}

export const ticketIn = (text: string) => text.match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? ''

// Whether a pull request is the work of a session: Claude Code linked it to the
// session, it is on the session's branch, or it names the ticket in that branch
// (or, on a detached worktree, in the worktree's folder name).
export const prBelongsTo = (
  pr: { url: string; branch: string; title: string },
  session: Pick<Session, 'branch' | 'prUrls' | 'top' | 'dir'>,
) => {
  const key = ticketIn(session.branch) || ticketIn(worktreeOf(session).name)

  return (
    session.prUrls.includes(pr.url) ||
    (!!session.branch && pr.branch === session.branch) ||
    (!!key && (mentions(pr.branch, key) || mentions(pr.title, key)))
  )
}

// A memory link's target, the way links are written in practice: by the note's
// name or its file name, with dashes and underscores used interchangeably.
export const memoryKey = (name: string) => name.trim().replace(/\.md$/, '').replace(/_/g, '-').toLowerCase()

export const memoryLinks = (body: string) => [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]!)

// A greeting for the local hour: the small hours still read as evening.
export const greeting = (now: number) => {
  const hour = new Date(now).getHours()

  return hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening'
}

export type PrEvent = 'opened' | 'merged' | 'closed' | 'open' | 'waiting' | 'rejected'

export type BriefPr = {
  url: string
  number: number
  title: string
  repo: string
  event: PrEvent
  at: number
  day: 'today' | 'yesterday' | null
  ci: CiState | null
}

// Midnight at the start of yesterday, local time.
export const startOfYesterday = (now: number) => {
  const date = new Date(now)

  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - 1)

  return date.getTime()
}

// Every pull request worth a line in the briefing: what you opened, merged, or
// closed since yesterday, what is still open, and the review queue, one line per URL.
export const briefingPrs = (
  recent: RecentPr[],
  open: PullRequest[],
  queue: ReviewQueue | null,
  now: number,
): BriefPr[] => {
  const start = startOfYesterday(now)
  const today = start + 86_400_000
  const dayOf = (at: number) => (at >= today ? 'today' : at >= start ? 'yesterday' : null)
  const ciOf = new Map(open.map(pr => [pr.url, pr.ci]))
  const byUrl = new Map<string, BriefPr>()
  const add = (pr: Omit<BriefPr, 'day' | 'ci'>) => {
    if (!byUrl.has(pr.url)) byUrl.set(pr.url, { ...pr, day: dayOf(pr.at), ci: ciOf.get(pr.url) ?? null })
  }

  for (const pr of queue?.waiting ?? []) {
    add({ url: pr.url, number: pr.number, title: pr.title, repo: queue!.repo, event: 'waiting', at: pr.createdAt })
  }

  for (const pr of queue?.recent ?? []) {
    if (pr.closedAt === null || pr.closedAt < start || pr.outcome === 'waiting') continue
    add({ url: pr.url, number: pr.number, title: pr.title, repo: queue!.repo, event: pr.outcome, at: pr.closedAt })
  }

  for (const pr of recent) {
    const base = { url: pr.url, number: pr.number, title: pr.title, repo: pr.repo }

    if (pr.state === 'open') {
      add(pr.createdAt >= start ? { ...base, event: 'opened', at: pr.createdAt } : { ...base, event: 'open', at: pr.updatedAt })
    } else if (pr.closedAt !== null && pr.closedAt >= start) {
      add({ ...base, event: pr.state, at: pr.closedAt })
    }
  }

  for (const pr of open) {
    add({ url: pr.url, number: pr.number, title: pr.title, repo: pr.repo, event: 'open', at: pr.updatedAt })
  }

  return [...byUrl.values()].sort((a, b) => b.at - a.at)
}
