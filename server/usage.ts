import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Session, Usage, UsageDay } from '../shared/types'
import {
  type ArtifactCall,
  DAY_MS,
  localDay,
  briefingDay,
  worktreeNameOf,
  parseArtifactCalls,
  parseCustomTitle,
  parseSkillUses,
  parseSessionRow,
  parsePrLink,
  parseRecapLine,
  parseToolResults,
  publishedArtifact, parseTitleLine, parseToolLine, parseUsageLine } from './pure'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const DAYS = 14
const CHUNK = 8 * 1024 * 1024

type Cursor = { offset: number; remainder: string }

const cursors = new Map<string, Cursor>()
const seen = new Set<string>()
const days = new Map<string, UsageDay>()
const titles = new Map<string, string>()
const responsesBySession = new Map<string, number>()
const toolRows = new Set<string>()
const recaps = new Map<string, { at: number; text: string }>()
const prLinks = new Map<string, string[]>()
const artifactCalls = new Map<string, ArtifactCall>()
const customTitles = new Map<string, string>()
const skillUses = new Map<string, { count: number; lastAt: number }>()
const countedSkillUses = new Set<string>()

type SessionDay = { firstAt: number; lastAt: number; cwd: string; branch: string; responses: number }

// What each session did on each local day: when it started and stopped, where
// it ran, and how many responses Claude gave.
const sessionDays = new Map<string, Map<string, SessionDay>>()

const touchDay = (sessionId: string, at: number) => {
  const date = localDay(at)
  const days = sessionDays.get(sessionId) ?? new Map<string, SessionDay>()
  const day = days.get(date) ?? { firstAt: at, lastAt: at, cwd: '', branch: '', responses: 0 }

  day.firstAt = Math.min(day.firstAt, at)
  day.lastAt = Math.max(day.lastAt, at)
  days.set(date, day)
  sessionDays.set(sessionId, days)

  return day
}

// The sessions of the last day with work before today, for the briefing.
export const briefingOf = (now: number) => {
  const today = localDay(now)
  const active: string[] = []

  for (const days of sessionDays.values()) {
    for (const [date, day] of days) if (day.responses > 0) active.push(date)
  }

  const day = briefingDay(active, today)
  const yesterday = localDay(now - DAY_MS)
  const sessions = day
    ? [...sessionDays]
        .map(([id, days]) => ({ id, day: days.get(day) }))
        .filter((entry): entry is { id: string; day: SessionDay } => !!entry.day && entry.day.responses > 0)
        .map(({ id, day: d }) => ({
          id,
          title: customTitles.get(id) || titles.get(id) || '',
          worktree: worktreeNameOf(d.cwd),
          cwd: d.cwd,
          branch: d.branch,
          responses: d.responses,
          firstAt: d.firstAt,
          lastAt: d.lastAt,
          recap: recaps.get(id)?.text ?? '',
        }))
        .sort((a, b) => b.responses - a.responses)
    : []
  const todaySessions = [...sessionDays.values()].filter(days => (days.get(today)?.responses ?? 0) > 0).length

  return { day: day ?? '', isYesterday: day === yesterday, sessions, todaySessions }
}

export type ScannedArtifact = {
  url: string
  title: string
  description: string
  filePath: string
  version: number
  createdAt: number
  updatedAt: number
  sessionIds: Set<string>
}

const artifacts = new Map<string, ScannedArtifact>()

// Every artifact a session published, from its publish calls and their results.
export const scannedArtifacts = () => [...artifacts.values()]

// The pull requests Claude Code linked to a session, newest first.
export const prUrlsOf = (sessionId: string) => [...(prLinks.get(sessionId) ?? [])].reverse()

// The newest recap of a session, once a scan has read its transcript.
export const recapOf = (sessionId: string) => recaps.get(sessionId) ?? { at: 0, text: '' }
const toolsByDay: Record<string, number> = {}

// Claude's tool calls per local day, from every transcript still on disk.
export const toolCallsByDay = () => toolsByDay

const SCAN_DAYS = 40

// The automatic title of a session, once a scan has read its transcript.
export const titleOf = (sessionId: string) => titles.get(sessionId) ?? ''

// How often each skill was used in the scanned transcripts, by name, whether
// Claude called it or the person typed its command.
export const skillUsageOf = (name: string) => skillUses.get(name) ?? { count: 0, lastAt: 0 }

// The name the session was given with /rename, as its transcript records it.
export const renamedOf = (sessionId: string) => customTitles.get(sessionId) ?? ''

// How many responses a session's transcript holds, once a scan has read it.
export const responsesOf = (sessionId: string) => responsesBySession.get(sessionId) ?? 0

// When a session last wrote to its transcript, within the scanned days.
export const lastSeenOf = (sessionId: string) =>
  Math.max(0, ...[...(sessionDays.get(sessionId)?.values() ?? [])].map(day => day.lastAt))

const emptyDay = (date: string): UsageDay => ({
  date,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  responses: 0,
  byModel: {},
})

const transcripts = async (dir: string, since: number): Promise<string[]> => {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      out.push(...(await transcripts(path, since)))
    } else if (entry.name.endsWith('.jsonl')) {
      const info = await stat(path).catch(() => null)

      if (info && info.mtimeMs >= since) out.push(path)
    }
  }

  return out
}

const consume = (text: string, oldest: number) => {
  for (const line of text.split('\n')) {
    const row = parseSessionRow(line)

    if (row) {
      const day = touchDay(row.sessionId, row.at)

      if (row.cwd) day.cwd = row.cwd
      if (row.branch && row.branch !== 'HEAD') day.branch = row.branch
    }

    for (const use of parseSkillUses(line)) {
      if (countedSkillUses.has(use.id)) continue

      countedSkillUses.add(use.id)

      const seen = skillUses.get(use.name) ?? { count: 0, lastAt: 0 }

      skillUses.set(use.name, { count: seen.count + 1, lastAt: Math.max(seen.lastAt, use.at) })
    }

    const custom = parseCustomTitle(line)

    if (custom) {
      customTitles.set(custom.sessionId, custom.title)
      continue
    }

    const title = parseTitleLine(line)

    if (title) {
      titles.set(title.sessionId, title.title)
      continue
    }

    for (const call of parseArtifactCalls(line)) artifactCalls.set(call.id, call)

    for (const result of parseToolResults(line)) {
      const call = artifactCalls.get(result.toolUseId)
      const published = call ? publishedArtifact(result.text) : null

      if (!call || !published) continue

      const known = artifacts.get(published.url)
      const at = result.at || call.at
      const str = (key: string) => (typeof call.input[key] === 'string' ? (call.input[key] as string) : '')

      artifacts.set(published.url, {
        url: published.url,
        title: str('title') || known?.title || '',
        description: str('description') || known?.description || '',
        filePath: str('file_path') || known?.filePath || '',
        version: Math.max(published.version, known?.version ?? 0),
        createdAt: Math.min(at, known?.createdAt ?? at),
        updatedAt: Math.max(at, known?.updatedAt ?? 0),
        sessionIds: new Set([...(known?.sessionIds ?? []), ...(call.sessionId ? [call.sessionId] : [])]),
      })
      artifactCalls.delete(result.toolUseId)
    }

    const link = parsePrLink(line)

    if (link) {
      prLinks.set(link.sessionId, [...(prLinks.get(link.sessionId) ?? []).filter(url => url !== link.url), link.url])
      continue
    }

    const recap = parseRecapLine(line)

    if (recap) {
      if (recap.at >= (recaps.get(recap.sessionId)?.at ?? 0)) recaps.set(recap.sessionId, recap)
      continue
    }

    const tools = parseToolLine(line)

    if (tools && !toolRows.has(tools.uuid)) {
      toolRows.add(tools.uuid)
      const day = localDay(tools.at)
      toolsByDay[day] = (toolsByDay[day] ?? 0) + tools.tools
    }

    const record = parseUsageLine(line)

    if (!record || seen.has(record.id)) continue

    seen.add(record.id)

    if (record.sessionId) {
      responsesBySession.set(record.sessionId, (responsesBySession.get(record.sessionId) ?? 0) + 1)
      touchDay(record.sessionId, record.at).responses += 1
    }

    if (record.at < oldest) continue

    const date = localDay(record.at)
    const day = days.get(date) ?? emptyDay(date)

    day.input += record.input
    day.output += record.output
    day.cacheRead += record.cacheRead
    day.cacheWrite += record.cacheWrite
    day.responses += 1
    day.byModel[record.model] = (day.byModel[record.model] ?? 0) + record.output
    days.set(date, day)
  }
}

const readNew = async (path: string, oldest: number) => {
  const info = await stat(path)
  const cursor = cursors.get(path) ?? { offset: 0, remainder: '' }

  if (info.size < cursor.offset) {
    cursor.offset = 0
    cursor.remainder = ''
  }

  if (info.size === cursor.offset) return

  const handle = await open(path, 'r')

  try {
    while (cursor.offset < info.size) {
      const length = Math.min(CHUNK, info.size - cursor.offset)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, cursor.offset)

      if (bytesRead === 0) break

      cursor.offset += bytesRead

      const text = cursor.remainder + buffer.subarray(0, bytesRead).toString('utf8')
      const cut = text.lastIndexOf('\n')

      consume(text.slice(0, cut + 1), oldest)
      cursor.remainder = text.slice(cut + 1)
    }
  } finally {
    await handle.close()
  }

  cursors.set(path, cursor)
}

const windowsFrom = (sessions: Session[]) => {
  const reporter = sessions.find(s => s.h5 !== null || s.d7 !== null)

  return {
    fiveHour: reporter?.h5 != null ? { percent: reporter.h5, resetsAt: reporter.h5ResetAt } : null,
    sevenDay: reporter?.d7 != null ? { percent: reporter.d7, resetsAt: reporter.d7ResetAt } : null,
    windowsReportedAt: reporter?.seenAt ?? 0,
  }
}

export const collectUsage = async (sessions: Session[], now: number): Promise<Usage> => {
  const oldest = now - (DAYS + 1) * DAY_MS
  const files = await transcripts(PROJECTS_DIR, now - SCAN_DAYS * DAY_MS)

  for (const file of files) {
    await readNew(file, oldest).catch(() => undefined)
  }

  const series: UsageDay[] = []

  for (let i = DAYS - 1; i >= 0; i--) {
    const date = localDay(now - i * DAY_MS)
    series.push(days.get(date) ?? emptyDay(date))
  }

  const today = localDay(now)
  const costs = sessions.filter(s => s.cost !== null && localDay(s.seenAt) === today).map(s => s.cost!)

  return {
    days: series,
    ...windowsFrom(sessions),
    todayCost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    scannedAt: Date.now(),
  }
}
