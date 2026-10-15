import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ContributionDay, Contributions } from '../shared/types'
import { DAY_MS, claudeActivity, localDay } from './pure'
import { toolCallsByDay } from './usage'

export const WEEKS = 26

const STATS = join(homedir(), '.claude', 'stats-cache.json')
const GITHUB_TTL_MS = 30 * 60_000
const QUERY =
  'query { viewer { contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }'

let github: Record<string, number> = {}
let githubAt = 0

const refreshGithub = async () => {
  const out = await new Promise<string>((resolve, reject) => {
    execFile('gh', ['api', 'graphql', '-f', `query=${QUERY}`], { timeout: 30_000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    )
  })
  const weeks = (
    JSON.parse(out) as {
      data: { viewer: { contributionsCollection: { contributionCalendar: { weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }> } } } }
    }
  ).data.viewer.contributionsCollection.contributionCalendar.weeks

  github = Object.fromEntries(weeks.flatMap(w => w.contributionDays.map(d => [d.date, d.contributionCount])))
  githubAt = Date.now()
}

const readStatsCache = async () => {
  try {
    const stats = JSON.parse(await readFile(STATS, 'utf8')) as {
      lastComputedDate?: string
      dailyActivity?: Array<{ date: string; toolCallCount: number }>
    }

    return {
      lastComputedDate: stats.lastComputedDate ?? '',
      tools: Object.fromEntries((stats.dailyActivity ?? []).map(d => [d.date, d.toolCallCount])),
    }
  } catch {
    return { lastComputedDate: '', tools: {} }
  }
}

// The days the heatmap shows: WEEKS whole weeks, Sunday to Saturday, ending
// with the current week, as GitHub lays out its calendar.
export const calendarDays = (now: number, weeks = WEEKS): string[] => {
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  const start = today.getTime() - (today.getDay() + (weeks - 1) * 7) * DAY_MS

  return Array.from({ length: weeks * 7 }, (_, i) => localDay(start + i * DAY_MS)).filter(d => d <= localDay(now))
}

export const collectContributions = async (now: number): Promise<Contributions> => {
  if (now - githubAt > GITHUB_TTL_MS) await refreshGithub()

  const cache = await readStatsCache()
  const transcripts = toolCallsByDay()
  const days: ContributionDay[] = calendarDays(now).map(date => ({
    date,
    github: github[date] ?? 0,
    claude: claudeActivity(date, cache, transcripts),
  }))

  return { days, githubAt }
}
