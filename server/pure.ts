import type { Activity, Check, CiState } from '../shared/types'

export const DAY_MS = 86_400_000
export const ACTIVE_WITHIN_MS = 3 * DAY_MS
export const IDLE_WITHIN_MS = 14 * DAY_MS
export const LIVE_SESSION_MS = 5 * 60_000

export type PorcelainEntry = { path: string; head: string; branch: string; isDetached: boolean }

export const parseWorktreePorcelain = (text: string): PorcelainEntry[] => {
  const entries: PorcelainEntry[] = []
  let current: PorcelainEntry | null = null

  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current)
      current = { path: line.slice(9), head: '', branch: '', isDetached: false }
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice(5)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    } else if (current && line === 'detached') {
      current.isDetached = true
    }
  }

  if (current) entries.push(current)

  return entries
}

export const parseListeners = (ssOutput: string): Array<{ port: string; pid: number }> => {
  const seen = new Set<string>()
  const out: Array<{ port: string; pid: number }> = []

  for (const line of ssOutput.split('\n')) {
    const columns = line.trim().split(/\s+/)
    const local = columns[3]

    if (!local || !line.includes('pid=')) continue

    const port = local.slice(local.lastIndexOf(':') + 1)

    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const key = `${port}:${match[1]}`

      if (seen.has(key)) continue
      seen.add(key)
      out.push({ port, pid: Number(match[1]) })
    }
  }

  return out
}

export const parseReflogTimes = (text: string): number[] => {
  const times: number[] = []

  for (const line of text.split('\n')) {
    const match = /> (\d{9,}) [+-]\d{4}\t/.exec(line)

    if (match) times.push(Number(match[1]) * 1000)
  }

  return times
}

export const classifyWorktree = (input: {
  lastTouchedAt: number
  hasDevServer: boolean
  hasLiveSession: boolean
  now: number
}): Activity => {
  if (input.hasDevServer || input.hasLiveSession) return 'active'

  const age = input.now - input.lastTouchedAt

  if (age <= ACTIVE_WITHIN_MS) return 'active'
  if (age <= IDLE_WITHIN_MS) return 'idle'

  return 'dormant'
}

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)

  return d.getTime()
}

export const activityDays = (timestamps: number[], now: number, days = 14): number[] => {
  const today = startOfDay(now)
  const buckets = new Array<number>(days).fill(0)

  for (const ts of timestamps) {
    const offset = Math.round((today - startOfDay(ts)) / DAY_MS)

    if (offset >= 0 && offset < days) buckets[days - 1 - offset]! += 1
  }

  return buckets
}

// Names the environment a URL points at by the first rule whose `match` equals
// or appears in its host; a local host is LOCAL, and any other shows its host.
export const envOf = (url: string, rules: Array<{ match: string; name: string }> = []): string => {
  if (!url) return ''

  const host = url.replace(/^[a-z]+:\/\//i, '').split(/[/:]/)[0] ?? ''
  const rule = rules.find(r => r.match && (host === r.match || host.includes(r.match)))

  if (rule) return rule.name
  if (host === 'localhost' || host.startsWith('127.')) return 'LOCAL'

  return host
}

export const readEnvValue = (text: string, key: string): string => {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`)
  let value = ''

  for (const line of text.split('\n')) {
    const match = pattern.exec(line)

    if (match) value = match[1]!.trim().replace(/^['"]|['"]$/g, '')
  }

  return value
}

export type RollupItem = {
  __typename?: string
  name?: string
  context?: string
  workflowName?: string
  status?: string
  conclusion?: string
  state?: string
  startedAt?: string
  completedAt?: string
  detailsUrl?: string
  targetUrl?: string
}

const time = (iso?: string) => {
  const ms = iso ? Date.parse(iso) : NaN

  return Number.isFinite(ms) && ms > 0 ? ms : null
}

const checkState = (item: RollupItem): Check['state'] => {
  if (item.__typename === 'StatusContext') {
    const s = item.state ?? ''

    return s === 'SUCCESS' ? 'success' : s === 'PENDING' || s === 'EXPECTED' ? 'pending' : 'failure'
  }

  if (item.status !== 'COMPLETED') return 'pending'

  switch (item.conclusion) {
    case 'SUCCESS':
      return 'success'
    case 'SKIPPED':
      return 'skipped'
    case 'NEUTRAL':
      return 'neutral'
    default:
      return 'failure'
  }
}

export const toChecks = (rollup: RollupItem[]): Check[] =>
  rollup.map(item => ({
    name: item.name ?? item.context ?? '?',
    workflow: item.workflowName ?? '',
    state: checkState(item),
    url: item.detailsUrl ?? item.targetUrl ?? '',
    startedAt: time(item.startedAt),
    completedAt: time(item.completedAt),
  }))

export const ciOf = (checks: Check[]): CiState => {
  if (checks.length === 0) return 'none'
  if (checks.some(c => c.state === 'pending')) return 'running'
  if (checks.some(c => c.state === 'failure')) return 'failing'

  return 'passing'
}

export const localDay = (ms: number) => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type UsageRecord = {
  id: string
  sessionId: string
  at: number
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// One assistant response's usage from a transcript line, or null for any other
// line. Streaming writes the same response several times; callers dedupe by id.
export const parseUsageLine = (line: string): UsageRecord | null => {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null

  try {
    const row = JSON.parse(line) as {
      type?: string
      sessionId?: string
      timestamp?: string
      message?: {
        id?: string
        model?: string
        usage?: {
          input_tokens?: number
          output_tokens?: number
          cache_read_input_tokens?: number
          cache_creation_input_tokens?: number
        }
      }
    }
    const message = row.message
    const usage = message?.usage

    if (row.type !== 'assistant' || !message?.id || !usage || !row.timestamp) return null
    if (message.model === '<synthetic>') return null

    return {
      id: message.id,
      sessionId: row.sessionId ?? '',
      at: Date.parse(row.timestamp),
      model: message.model ?? 'unknown',
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    }
  } catch {
    return null
  }
}

// The folder name Claude Code keeps a project's transcripts under.
export const projectSlug = (path: string) => path.replace(/[^a-zA-Z0-9-]/g, '-')

// The folders a session may have been started from, nearest first: its current
// folder and every parent of it, then its worktree root. A session started in
// the main checkout that later entered a worktree under it keeps its transcript
// with the main checkout, a parent of where it runs now.
export const resumeCandidates = (dir: string, top: string): string[] => {
  const out: string[] = []
  let current = dir || top

  while (current && current !== '/') {
    out.push(current)
    current = current.slice(0, current.lastIndexOf('/'))
  }

  if (top && !out.includes(top)) out.push(top)

  return out
}

// A process's start time from /proc/<pid>/stat (field 22, in clock ticks). The
// command name in field 2 may hold spaces, so fields are counted after its ')'.
export const procStartOf = (stat: string): string => {
  const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')

  return rest[19] ?? ''
}

// The title Claude Code generated for a session, from an "ai-title" transcript
// row; the newest row wins, so callers keep the last one they read.
export const parseTitleLine = (line: string): { sessionId: string; title: string } | null => {
  if (!line.includes('"ai-title"')) return null

  try {
    const row = JSON.parse(line) as { type?: string; aiTitle?: string; sessionId?: string }

    return row.type === 'ai-title' && row.aiTitle && row.sessionId
      ? { sessionId: row.sessionId, title: row.aiTitle }
      : null
  } catch {
    return null
  }
}

// Queue labels read "<check> - <state>", like "ci:test:sf - success".
export const queueLabel = (name: string): { name: string; state: 'success' | 'failure' | 'pending' | 'other' } => {
  const match = /^(.*?)\s+-\s+(\w+)$/.exec(name.trim())

  if (!match) return { name, state: 'other' }

  const state = match[2]!.toLowerCase()

  return {
    name: match[1]!,
    state: state === 'success' ? 'success' : state === 'failure' || state === 'error' ? 'failure' : state === 'pending' ? 'pending' : 'other',
  }
}

// Forwarded branches can name who sent them, like ci-forward-ABC-1-pr-7-sender-<login>
// for the suffix "-sender-{login}".
export const isSentBy = (branch: string, login: string, suffix: string) =>
  !!login && !!suffix && branch.toLowerCase().endsWith(suffix.replace('{login}', login).toLowerCase())

export const ticketOf = (text: string) => /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(text)?.[1] ?? ''

export type QueueComment = { author: { login: string }; body: string }

// How the reviewer closed a pull request: a comment matching the merged pattern
// lands it, any other comment turns it down (the last one says why), and one the
// reviewer never commented on was closed by someone else, such as its sender.
export const queueOutcome = (
  comments: QueueComment[],
  reviewer: string,
  mergedPattern = '^merged\\b',
): { outcome: 'merged' | 'rejected' | 'closed'; reason: string } => {
  const merged = new RegExp(mergedPattern, 'i')
  const theirs = comments.filter(c => c.author.login.toLowerCase() === reviewer.toLowerCase())

  if (theirs.some(c => merged.test(c.body.trim()))) return { outcome: 'merged', reason: '' }

  const last = theirs[theirs.length - 1]

  if (!last) return { outcome: 'closed', reason: '' }

  const reason = last.body
    .replace(/@[\w-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { outcome: 'rejected', reason: reason.length > 240 ? `${reason.slice(0, 239)}…` : reason }
}

// The tool calls one transcript row holds. Claude Code writes each block of a
// response on its own row, so rows are counted once each by their uuid, never
// by message id, or a response with several tool calls would count as one.
export const parseToolLine = (line: string): { uuid: string; at: number; tools: number } | null => {
  if (!line.includes('"tool_use"') || !line.includes('"assistant"')) return null

  try {
    const row = JSON.parse(line) as {
      type?: string
      uuid?: string
      timestamp?: string
      message?: { content?: unknown }
    }
    const content = row.message?.content

    if (row.type !== 'assistant' || !row.uuid || !row.timestamp || !Array.isArray(content)) return null

    const tools = content.filter(block => (block as { type?: string })?.type === 'tool_use').length

    return tools ? { uuid: row.uuid, at: Date.parse(row.timestamp), tools } : null
  } catch {
    return null
  }
}

// Claude's tool calls per day: the stats cache up to the day it was computed,
// transcripts after it. Transcripts older than a month are cleaned up, while the
// cache keeps the whole history; on the days both hold, they agree.
export const claudeActivity = (
  date: string,
  cache: { lastComputedDate: string; tools: Record<string, number> },
  transcripts: Record<string, number>,
) => (cache.lastComputedDate && date <= cache.lastComputedDate ? (cache.tools[date] ?? 0) : (transcripts[date] ?? 0))

type AgentRow = { type?: string; message?: { stop_reason?: string; content?: unknown } }

const blocksOf = (row: AgentRow) => (Array.isArray(row.message?.content) ? (row.message!.content as Array<{ type?: string; name?: string }>) : [])

// Whether a subagent is done, judged from the last rows of its transcript. It
// is done after a final answer (an assistant row that stopped on end_turn with
// no tool call), or once its SubagentHandback call, which hands its report to
// the parent, has its result. Anything else means it is still working, or was
// cut off, which the caller bounds by the file's age.
export const isAgentFinished = (tail: string[]): boolean => {
  const rows = tail
    .map(line => {
      try {
        return JSON.parse(line) as AgentRow
      } catch {
        return null
      }
    })
    .filter((row): row is AgentRow => row !== null)
  const last = rows[rows.length - 1]

  if (!last) return false

  if (last.type === 'assistant' && last.message?.stop_reason === 'end_turn' && !blocksOf(last).some(b => b.type === 'tool_use')) {
    return true
  }

  const lastCall = [...rows].reverse().find(row => row.type === 'assistant' && blocksOf(row).some(b => b.type === 'tool_use'))

  return (
    last.type === 'user' &&
    blocksOf(last).some(b => b.type === 'tool_result') &&
    !!lastCall &&
    blocksOf(lastCall).some(b => b.type === 'tool_use' && b.name === 'SubagentHandback')
  )
}

// The recap Claude Code shows when you return to a session, from its
// "away_summary" transcript row, without the hint about turning recaps off.
export const parseRecapLine = (line: string): { sessionId: string; at: number; text: string } | null => {
  if (!line.includes('"away_summary"')) return null

  try {
    const row = JSON.parse(line) as { type?: string; subtype?: string; sessionId?: string; timestamp?: string; content?: string }

    if (row.type !== 'system' || row.subtype !== 'away_summary' || !row.sessionId || !row.content) return null

    const text = row.content.replace(/\s*\(disable recaps in \/config\)\s*$/i, '').trim()

    return text ? { sessionId: row.sessionId, at: Date.parse(row.timestamp ?? '') || 0, text } : null
  } catch {
    return null
  }
}

// A pull request Claude Code linked to a session, from a "pr-link" transcript
// row: the one it shows in its own footer. A link merely printed in the
// conversation is not one, so a session that only looked at a pull request
// never claims it.
export const parsePrLink = (line: string): { sessionId: string; url: string } | null => {
  if (!line.includes('"pr-link"')) return null

  try {
    const row = JSON.parse(line) as { type?: string; sessionId?: string; prUrl?: string }

    return row.type === 'pr-link' && row.sessionId && row.prUrl ? { sessionId: row.sessionId, url: row.prUrl } : null
  } catch {
    return null
  }
}

// A memory note: its frontmatter (name, description, type at the top or under
// metadata) and the body after it.
export const parseMemoryNote = (text: string) => {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  const front = match?.[1] ?? ''
  const body = (match?.[2] ?? text).trim()
  const field = (key: string) => {
    const found = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm').exec(front)?.[1]?.trim() ?? ''

    return found.replace(/^["']|["']$/g, '')
  }

  return { name: field('name'), description: field('description'), type: field('type') || 'note', body }
}

// The frontmatter fields of a SKILL.md: plain, quoted, or folded over several
// indented lines (YAML's ">" and "|").
export const parseSkill = (text: string) => {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const lines = front.split(/\r?\n/)
  const field = (key: string) => {
    const at = lines.findIndex(line => new RegExp(`^${key}:`).test(line))

    if (at < 0) return ''

    const first = lines[at]!.slice(key.length + 1).trim()
    const rest: string[] = []

    for (const line of lines.slice(at + 1)) {
      if (!/^\s+\S/.test(line)) break

      rest.push(line.trim())
    }

    const value = /^[>|][-+]?$/.test(first) ? rest.join(' ') : [first, ...rest].join(' ')
    const quoted = /^(["'])([\s\S]*)\1$/.exec(value.trim())

    return (quoted ? quoted[2]!.replace(/\\"/g, '"') : value).replace(/\s+/g, ' ').trim()
  }

  return { name: field('name'), description: field('description'), argumentHint: field('argument-hint') }
}

// The MEMORY.md index: each line's title and one-line hook, by file name.
export const parseMemoryIndex = (text: string) => {
  const entries = new Map<string, { title: string; hook: string }>()

  for (const line of text.split('\n')) {
    const match = /^-\s*\[(.+?)\]\(([^)]+\.md)\)\s*(?:[—–-]+\s*(.*))?$/.exec(line.trim())

    if (match) entries.set(match[2]!, { title: match[1]!, hook: (match[3] ?? '').trim() })
  }

  return entries
}

export type ArtifactCall = { id: string; sessionId: string; at: number; input: Record<string, unknown> }

// Artifact tool calls that publish a page: the publish action (the default)
// with a page, not an asset upload, a read, a list or an open.
export const parseArtifactCalls = (line: string): ArtifactCall[] => {
  if (!line.includes('"name":"Artifact"') || !line.includes('"tool_use"')) return []

  try {
    const row = JSON.parse(line) as {
      type?: string
      sessionId?: string
      timestamp?: string
      message?: { content?: Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }> }
    }

    if (row.type !== 'assistant' || !Array.isArray(row.message?.content)) return []

    return row.message!.content
      .filter(block => block.type === 'tool_use' && block.name === 'Artifact' && block.id)
      .filter(block => {
        const action = block.input?.action

        return (action === undefined || action === 'publish') && block.input?.asset !== true
      })
      .map(block => ({
        id: block.id!,
        sessionId: row.sessionId ?? '',
        at: Date.parse(row.timestamp ?? '') || 0,
        input: block.input ?? {},
      }))
  } catch {
    return []
  }
}

const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/

// The results of tool calls a user row carries, by the call they answer, as
// text: where a publish reports the artifact's URL and version.
export const parseToolResults = (line: string): Array<{ toolUseId: string; at: number; text: string }> => {
  if (!line.includes('"tool_result"') || !line.includes('claude.ai/')) return []

  try {
    const row = JSON.parse(line) as {
      type?: string
      timestamp?: string
      message?: { content?: Array<{ type?: string; tool_use_id?: string; content?: unknown }> }
    }

    if (row.type !== 'user' || !Array.isArray(row.message?.content)) return []

    return row.message!.content
      .filter(block => block.type === 'tool_result' && block.tool_use_id)
      .map(block => ({
        toolUseId: block.tool_use_id!,
        at: Date.parse(row.timestamp ?? '') || 0,
        text:
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map(part => (part as { text?: string })?.text ?? '').join('\n')
              : '',
      }))
  } catch {
    return []
  }
}

export const publishedArtifact = (text: string) => {
  const url = ARTIFACT_URL.exec(text)?.[0]

  return url ? { url, version: Number(/Version (\d+)/.exec(text)?.[1] ?? 1) } : null
}

export const htmlTitle = (html: string) =>
  /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''

// Where and when a session worked, from a conversation row: its folder, branch
// and time, read without parsing the whole row. Subagent rows are skipped so a
// session's own conversation is what counts.
export const parseSessionRow = (line: string): { sessionId: string; at: number; cwd: string; branch: string } | null => {
  if (!line.startsWith('{"') || line.includes('"isSidechain":true')) return null
  if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return null

  const sessionId = /"sessionId":"([0-9a-f-]{36})"/.exec(line)?.[1]
  const timestamp = /"timestamp":"([^"]+)"/.exec(line)?.[1]

  if (!sessionId || !timestamp) return null

  return {
    sessionId,
    at: Date.parse(timestamp) || 0,
    cwd: /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line)?.[1] ?? '',
    branch: /"gitBranch":"((?:[^"\\]|\\.)*)"/.exec(line)?.[1] ?? '',
  }
}

// The name a session was given with /rename: an "agent-name" row, which Claude
// Code writes again as the session goes on, or the older "custom-title" row.
export const parseCustomTitle = (line: string): { sessionId: string; title: string } | null => {
  if (!line.includes('"agent-name"') && !line.includes('"custom-title"')) return null

  try {
    const row = JSON.parse(line) as { type?: string; sessionId?: string; customTitle?: string; agentName?: string }
    const title = row.type === 'agent-name' ? row.agentName : row.type === 'custom-title' ? row.customTitle : ''

    return row.sessionId && title ? { sessionId: row.sessionId, title } : null
  } catch {
    return null
  }
}

// The day a briefing looks back on: yesterday, or the latest earlier day with
// any work, so a Monday reads Friday instead of an empty Sunday.
export const briefingDay = (activeDays: string[], today: string): string | null =>
  [...new Set(activeDays)].filter(day => day < today).sort().pop() ?? null

// The worktree a folder belongs to: the folder under .claude/worktrees, or the
// checkout above a module tree (workspaces, modules, portal-*), or the folder.
export const worktreeNameOf = (cwd: string) =>
  /\/\.claude\/worktrees\/([^/]+)/.exec(cwd)?.[1] ??
  /\/([^/]+)\/(?:workspaces|modules|portal-[a-z]+)(?:\/|$)/.exec(cwd)?.[1] ??
  cwd.split('/').filter(Boolean).pop() ??
  ''
