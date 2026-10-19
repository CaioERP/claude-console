import { open, readFile, readdir, readlink, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { FavoriteSession, PullRequest, RecentPr, Session, Snapshot, Worktree } from '../shared/types'
import { collectContributions } from './activity'
import { addFavorite, readFavorites, removeFavorite } from './favorites'
import { collectArtifacts } from './artifacts'
import { collectProfile } from './profile'
import { CONFIG_PATH, config, featuresOf } from './config'
import { quiet, run } from './exec'
import { collectJira } from './jira'
import { collectMemory } from './memory'
import { collectSkills } from './skills'
import { refreshDiskUsage } from './disk'
import { collectKnowledge } from './claude-config'
import { briefingInput } from './briefing-input'
import { currentSummary, ensureSummary } from './summary'
import { collectReviewQueue } from './queue'
import { briefingOf, collectUsage, lastSeenOf, prUrlsOf, recapOf, renamedOf, responsesOf, titleOf } from './usage'
import { readNames, setName } from './names'
import {
  DAY_MS,
  LIVE_SESSION_MS,
  activityDays,
  ciOf,
  classifyWorktree,
  envOf,
  parseListeners,
  parseReflogTimes,
  isAgentFinished,
  parseWorktreePorcelain,
  procStartOf,
  projectSlug,
  resumeCandidates,
  readEnvValue,
  toChecks,
  type RollupItem,
} from './pure'

const HOME = homedir()
const FLEET_DIR = join(HOME, '.claude', 'fleet')
const PROJECTS_DIR = join(HOME, '.claude', 'projects')
const REGISTRY_DIR = join(HOME, '.claude', 'sessions')

type Running = { pid: number; cwd: string; status: string; since: number; name: string; updatedAt: number; remoteUrl: string }

// Claude Code records a Remote Control session's id as bridgeSessionId; the
// session continues at claude.ai/code/<that id>.
const REMOTE_ID = /^session_[A-Za-z0-9]+$/

export const remoteUrlOf = (bridgeSessionId: unknown) =>
  typeof bridgeSessionId === 'string' && REMOTE_ID.test(bridgeSessionId) ? `https://claude.ai/code/${bridgeSessionId}` : ''

// The Claude Code processes running now, keyed by the session each one holds,
// from the per-process registry Claude Code keeps. A pid counts only while its
// start time still matches, so a reused pid is never taken for the session.
export const runningSessions = async (): Promise<Map<string, Running> | null> => {
  const files = await readdir(REGISTRY_DIR).catch(() => null)

  if (!files) return null

  const running = new Map<string, Running>()

  for (const file of files.filter(f => /^\d+\.json$/.test(f))) {
    try {
      const entry = JSON.parse(await readFile(join(REGISTRY_DIR, file), 'utf8')) as {
        pid: number
        sessionId: string
        cwd?: string
        procStart?: string
        status?: string
        statusUpdatedAt?: number
        name?: string
        updatedAt?: number
        bridgeSessionId?: string
      }
      const stat = await readFile(`/proc/${entry.pid}/stat`, 'utf8')

      if (entry.procStart && procStartOf(stat) !== entry.procStart) continue

      running.set(entry.sessionId, {
        pid: entry.pid,
        cwd: entry.cwd ?? '',
        status: entry.status ?? '',
        remoteUrl: remoteUrlOf(entry.bridgeSessionId),
        since: entry.statusUpdatedAt ?? 0,
        name: entry.name ?? '',
        updatedAt: entry.updatedAt ?? 0,
      })
    } catch {
      continue
    }
  }

  return running
}

const AGENT_ACTIVE_MS = 20 * 60_000

const lastLines = async (path: string, count = 4) => {
  const handle = await open(path, 'r')

  try {
    const { size } = await handle.stat()
    const length = Math.min(size, 256 * 1024)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').trimEnd().split('\n')

    return lines.slice(-count)
  } finally {
    await handle.close()
  }
}

// How many of a running session's subagents are still working: those whose
// transcript does not end in a final answer and that wrote in the last
// twenty minutes, so one cut off mid-way stops counting on its own.
export const workingAgents = async (sessionId: string, launchDir: string, now = Date.now()) => {
  const dir = join(PROJECTS_DIR, projectSlug(launchDir), sessionId, 'subagents')
  const files = (await readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith('.jsonl'))
  let working = 0

  for (const file of files) {
    const path = join(dir, file)

    if (now - (await mtime(path)) > AGENT_ACTIVE_MS) continue

    if (!isAgentFinished(await lastLines(path).catch(() => []))) working += 1
  }

  return working
}

const resumeDirOf = async (id: string, dir: string, top: string, launchDir = '') => {
  for (const candidate of [...(launchDir ? [launchDir] : []), ...resumeCandidates(dir, top)]) {
    if (await mtime(join(PROJECTS_DIR, projectSlug(candidate), `${id}.jsonl`))) return candidate
  }

  return ''
}

export const REPOS = config.repos


const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results = new Array<R>(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await fn(items[index]!)
      }
    }),
  )

  return results
}

const mtime = async (path: string) => quiet(stat(path).then(s => s.mtimeMs), 0)

const num = (value: unknown) => {
  if (value === '' || value === undefined || value === null) return null

  const n = Number(value)

  return Number.isFinite(n) ? n : null
}

const epochMs = (value: unknown) => {
  const n = num(value)

  return n === null ? null : n * 1000
}

export const collectSessions = async (now: number): Promise<Session[]> => {
  const [files, running] = await Promise.all([quiet(readdir(FLEET_DIR), [] as string[]), runningSessions()])
  const isLive = (id: string, seenAt: number) =>
    running ? running.has(id) : now - seenAt < LIVE_SESSION_MS
  const sessions = await Promise.all(
    files
      .filter(f => f.endsWith('.json'))
      .map(async file => {
        const path = join(FLEET_DIR, file)
        const [text, seenAt] = await Promise.all([quiet(readFile(path, 'utf8'), ''), mtime(path)])

        try {
          const raw = JSON.parse(text) as Record<string, unknown>
          const id = file.replace(/\.json$/, '')
          const top = String(raw.top ?? '')
          const dir = String(raw.dir ?? '')
          const proc = running?.get(id)

          const name = String(raw.name ?? '')

          return {
            id,
            name: name || renamedOf(id) || titleOf(id),
            isAutoTitle: !name && !renamedOf(id) && !!titleOf(id),
            responses: responsesOf(id),
            recap: recapOf(id).text,
            recapAt: recapOf(id).at,
            prUrls: prUrlsOf(id),
            branch: String(raw.branch ?? ''),
            model: String(raw.model ?? ''),
            top,
            dir,
            resumeDir: await resumeDirOf(id, dir, top, proc?.cwd),
            ctx: Number(raw.ctx ?? 0),
            h5: num(raw.h5),
            h5Reset: String(raw.h5reset ?? ''),
            h5ResetAt: epochMs(raw.h5resetAt),
            d7: num(raw.d7),
            d7ResetAt: epochMs(raw.d7resetAt),
            cost: num(raw.cost),
            seenAt: Math.max(seenAt, proc?.updatedAt ?? 0),
            isLive: isLive(id, seenAt),
            isRunning: !!proc,
            runStatus: proc?.status ?? '',
            runSince: proc?.since ?? 0,
            remoteUrl: proc?.remoteUrl ?? '',
          } satisfies Session
        } catch {
          return null
        }
      }),
  )
  const known = new Set(sessions.map(s => s?.id))

  // Running sessions the status line has not reported yet still belong here.
  for (const [id, proc] of running ?? []) {
    if (known.has(id)) continue

    const top = (await quiet(run('git', ['-C', proc.cwd, 'rev-parse', '--show-toplevel']), '')).trim()

    sessions.push({
      id,
      name: renamedOf(id) || titleOf(id),
      isAutoTitle: !renamedOf(id) && !!titleOf(id),
      responses: responsesOf(id),
      recap: recapOf(id).text,
      recapAt: recapOf(id).at,
      prUrls: prUrlsOf(id),
      branch: (await quiet(run('git', ['-C', proc.cwd, 'branch', '--show-current']), '')).trim(),
      model: '',
      top,
      dir: proc.cwd,
      resumeDir: await resumeDirOf(id, proc.cwd, top, proc.cwd),
      ctx: 0,
      h5: null,
      h5Reset: '',
      h5ResetAt: null,
      d7: null,
      d7ResetAt: null,
      cost: null,
      seenAt: proc.updatedAt,
      isLive: true,
      isRunning: true,
      runStatus: proc.status,
      runSince: proc.since,
      remoteUrl: proc.remoteUrl,
    })
  }

  return sessions.filter((s): s is Session => s !== null).sort((a, b) => b.seenAt - a.seenAt)
}

const devServersByWorktree = async () => {
  const byTop = new Map<string, string>()
  const output = await quiet(run('ss', ['-tlnp']), '')

  for (const { port, pid } of parseListeners(output)) {
    const cmdline = await quiet(readFile(`/proc/${pid}/cmdline`, 'utf8'), '')

    if (!cmdline.includes(config.devServer.process)) continue

    const cwd = await quiet(readlink(`/proc/${pid}/cwd`), '')
    const top = cwd ? (await quiet(run('git', ['-C', cwd, 'rev-parse', '--show-toplevel']), '')).trim() : ''

    if (top && !byTop.has(top)) byTop.set(top, port)
  }

  return byTop
}

// The URL a worktree's dev server talks to, from the first configured env file
// that sets the configured key.
const devUrlOf = async (path: string) => {
  if (!config.devEnv?.key) return ''

  for (const file of config.devEnv.files) {
    const text = await quiet(readFile(join(path, file), 'utf8'), '')
    const value = text ? readEnvValue(text, config.devEnv.key) : ''

    if (value) return value
  }

  return ''
}

export const collectWorktrees = async (sessions: Session[], now: number): Promise<Worktree[]> => {
  if (!REPOS.length) throw new Error(`No repository is configured: set "repo" in ${CONFIG_PATH} or CONSOLE_REPO.`)

  const [porcelains, servers] = await Promise.all([
    Promise.all(REPOS.map(repo => run('git', ['-C', repo, 'worktree', 'list', '--porcelain']))),
    devServersByWorktree(),
  ])
  const entries = REPOS.flatMap((repo, i) => parseWorktreePorcelain(porcelains[i]!).map(entry => ({ ...entry, repo })))

  return mapLimit(entries, 6, async (entry): Promise<Worktree> => {
    const { path } = entry
    const [gitDir, last, devUrl] = await Promise.all([
      quiet(run('git', ['-C', path, 'rev-parse', '--absolute-git-dir']), ''),
      quiet(run('git', ['-C', path, 'log', '-1', '--format=%h%x1f%ct%x1f%s']), ''),
      devUrlOf(path),
    ])
    const dir = gitDir.trim()
    const [indexAt, reflog] = await Promise.all([
      mtime(join(dir, 'index')),
      quiet(readFile(join(dir, 'logs', 'HEAD'), 'utf8'), ''),
    ])
    const [sha = '', committed = '0', subject = ''] = last.trim().split('\x1f')
    const committedAt = Number(committed) * 1000
    const moves = parseReflogTimes(reflog)
    const lastTouchedAt = Math.max(indexAt, ...moves, 0) || committedAt
    const own = sessions.filter(s => s.top === path)
    const devServerPort = servers.get(path) ?? ''

    return {
      path,
      name: basename(path),
      repo: entry.repo,
      repoName: REPOS.length > 1 ? (config.repoConfigs.find(r => r.path === entry.repo)?.name ?? basename(entry.repo)) : '',
      branch: entry.branch,
      isDetached: entry.isDetached,
      isMain: path === entry.repo,
      sha,
      subject,
      committedAt,
      lastTouchedAt,
      activityDays: activityDays(moves, now),
      devServerPort,
      devUrl,
      devEnv: envOf(devUrl, config.devEnv?.rules),
      sessions: own,
      activity: classifyWorktree({
        lastTouchedAt,
        hasDevServer: !!devServerPort,
        hasLiveSession: own.some(s => s.isLive),
        now,
      }),
    }
  })
}

type SearchHit = {
  author?: { login?: string }
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  repository: { nameWithOwner: string }
}

type PrDetail = {
  headRefName: string
  reviewDecision: string
  mergeStateStatus: string
  additions: number
  deletions: number
  statusCheckRollup: RollupItem[] | null
}

const searchPrs = async (qualifier: string) =>
  JSON.parse(
    await run(
      'gh',
      [
        'search', 'prs', qualifier, '--state=open', '--limit', '50',
        '--json', 'number,title,url,isDraft,createdAt,updatedAt,repository,author',
      ],
      { timeoutMs: 30_000 },
    ),
  ) as SearchHit[]

let ghLogin = ''

// Open pull requests by others that are assigned to you or ask for your
// review, once each.
export const collectAssignedPrs = async (worktrees: Worktree[]): Promise<PullRequest[]> => {
  ghLogin ||= (await run('gh', ['api', 'user', '--jq', '.login'])).trim()

  const [assigned, requested] = await Promise.all([searchPrs('--assignee=@me'), searchPrs('--review-requested=@me')])
  const byUrl = new Map([...assigned, ...requested].map(hit => [hit.url, hit] as const))
  const others = [...byUrl.values()].filter(hit => hit.author?.login !== ghLogin)

  return detailPrs(others, worktrees)
}

export const collectPrs = async (worktrees: Worktree[]): Promise<PullRequest[]> =>
  detailPrs(await searchPrs('--author=@me'), worktrees)

const detailPrs = async (hits: SearchHit[], worktrees: Worktree[]): Promise<PullRequest[]> => {
  return mapLimit(hits, 4, async hit => {
    const repo = hit.repository.nameWithOwner
    const detail = await quiet(
      run(
        'gh',
        [
          'pr', 'view', String(hit.number), '-R', repo,
          '--json', 'headRefName,reviewDecision,mergeStateStatus,additions,deletions,statusCheckRollup',
        ],
        { timeoutMs: 30_000 },
      ).then(out => JSON.parse(out) as PrDetail),
      null,
    )
    const checks = toChecks(detail?.statusCheckRollup ?? [])
    const branch = detail?.headRefName ?? ''

    return {
      repo,
      author: hit.author?.login ?? '',
      number: hit.number,
      title: hit.title,
      url: hit.url,
      isDraft: hit.isDraft,
      createdAt: Date.parse(hit.createdAt),
      updatedAt: Date.parse(hit.updatedAt),
      branch,
      reviewDecision: detail?.reviewDecision ?? '',
      mergeState: detail?.mergeStateStatus ?? '',
      additions: detail?.additions ?? 0,
      deletions: detail?.deletions ?? 0,
      checks,
      ci: ciOf(checks),
      worktreePath: worktrees.find(w => w.branch && w.branch === branch)?.path ?? '',
    }
  })
}

type SearchedPr = {
  number: number
  title: string
  url: string
  state: string
  createdAt: string
  closedAt: string | null
  updatedAt: string
  repository: { nameWithOwner: string }
}

const time = (iso: string | null) => {
  const ms = iso ? Date.parse(iso) : NaN

  return Number.isFinite(ms) && ms > 0 ? ms : null
}

// Every pull request you authored that moved since the start of yesterday:
// opened, merged, closed, or still open.
export const collectRecentPrs = async (now: number): Promise<RecentPr[]> => {
  const start = new Date(now - DAY_MS)
  const since = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  const hits = JSON.parse(
    await run(
      'gh',
      [
        'search', 'prs', '--author=@me', `--updated=>=${since}`, '--limit', '100',
        '--json', 'number,title,url,state,createdAt,closedAt,updatedAt,repository',
      ],
      { timeoutMs: 30_000 },
    ),
  ) as SearchedPr[]

  return hits.map(hit => ({
    repo: hit.repository.nameWithOwner,
    number: hit.number,
    title: hit.title,
    url: hit.url,
    state: hit.state === 'merged' ? 'merged' : hit.state === 'open' ? 'open' : 'closed',
    createdAt: time(hit.createdAt) ?? 0,
    closedAt: time(hit.closedAt),
    updatedAt: time(hit.updatedAt) ?? 0,
  }))
}

const WORKTREES_TTL_MS = 15_000
const PRS_TTL_MS = 90_000

// Changes every time the server starts, which is every time the service is
// restarted to pick up a new build, so open pages know to reload themselves.
export const BUILD = `${Date.now().toString(36)}-${process.pid}`

const state: Snapshot = {
  build: BUILD,
  generatedAt: 0,
  repo: REPOS.join(' · '),
  worktrees: [],
  prs: [],
  sessions: [],
  usage: null,
  jira: [],
  jiraAt: 0,
  queue: null,
  features: featuresOf(config),
  favorites: [],
  favoriteSessions: [],
  names: {},
  contributions: null,
  memory: [],
  skills: [],
  knowledge: { mcp: { servers: [], checkedAt: 0, error: '' }, instructions: [], hooks: [], extensions: [] },
  artifacts: [],
  profile: null,
  briefing: null,
  summary: { status: 'off', text: '', generatedAt: 0, model: '', error: '' },
  recentPrs: [],
  assignedPrs: [],
  worktreesAt: 0,
  prsAt: 0,
  errors: {},
}

let worktreesJob: Promise<void> | null = null
let prsJob: Promise<void> | null = null
let usageJob: Promise<void> | null = null
let usageAt = 0

const USAGE_TTL_MS = 60_000
const JIRA_TTL_MS = 120_000

let jiraJob: Promise<void> | null = null

const refreshJira = () =>
  (jiraJob ??= (async () => {
    try {
      if (config.jira) state.jira = await collectJira(config.jira)
      state.jiraAt = Date.now()
      delete state.errors.jira
    } catch (error) {
      state.errors.jira = error instanceof Error ? error.message : String(error)
    } finally {
      jiraJob = null
    }
  })())

const refreshUsage = () =>
  (usageJob ??= (async () => {
    try {
      state.usage = await collectUsage(state.sessions, Date.now())
      usageAt = Date.now()
      delete state.errors.usage
    } catch (error) {
      state.errors.usage = error instanceof Error ? error.message : String(error)
    }

    state.briefing = briefingOf(Date.now())

    try {
      state.artifacts = await collectArtifacts()
      delete state.errors.artifacts
    } catch (error) {
      state.errors.artifacts = error instanceof Error ? error.message : String(error)
    }

    if (!state.profile) {
      try {
        state.profile = await collectProfile()
        delete state.errors.profile
      } catch (error) {
        state.errors.profile = error instanceof Error ? error.message : String(error)
      }
    }

    try {
      // Personal skills once, plus each repository's project skills.
      const lists = await Promise.all(REPOS.map(collectSkills))

      state.skills = [...new Map(lists.flat().map(skill => [skill.path, skill])).values()]
      delete state.errors.skills
    } catch (error) {
      state.errors.skills = error instanceof Error ? error.message : String(error)
    }

    try {
      // Claude's setup (instructions, hooks, MCP) is read for the first
      // repository; with several, the others share the personal parts of it.
      state.knowledge = await collectKnowledge(REPOS[0] ?? '')
      delete state.errors.knowledge
    } catch (error) {
      state.errors.knowledge = error instanceof Error ? error.message : String(error)
    }

    try {
      const notes = await Promise.all(REPOS.map(collectMemory))

      // Notes of several repositories can share a file name, so each keeps its
      // repository's name in front.
      state.memory = REPOS.length > 1
        ? notes
            .flatMap((list, i) => list.map(note => ({ ...note, file: `${basename(REPOS[i]!)}/${note.file}` })))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : (notes[0] ?? [])
      delete state.errors.memory
    } catch (error) {
      state.errors.memory = error instanceof Error ? error.message : String(error)
    }

    try {
      state.contributions = await collectContributions(Date.now())
      delete state.errors.contributions
    } catch (error) {
      state.errors.contributions = error instanceof Error ? error.message : String(error)
    } finally {
      usageJob = null
    }
  })())

export const refreshWorktrees = () =>
  (worktreesJob ??= (async () => {
    const now = Date.now()

    try {
      state.sessions = await collectSessions(now)
      state.worktrees = await collectWorktrees(state.sessions, now)
      refreshDiskUsage(REPOS[0] ?? '', state.worktrees.map(w => w.path))
      state.worktreesAt = Date.now()
      delete state.errors.worktrees

      for (const pr of [...state.prs, ...state.assignedPrs]) {
        pr.worktreePath = state.worktrees.find(w => w.branch && w.branch === pr.branch)?.path ?? ''
      }
    } catch (error) {
      state.errors.worktrees = error instanceof Error ? error.message : String(error)
    } finally {
      worktreesJob = null
    }
  })())

const refreshPrs = () =>
  (prsJob ??= (async () => {
    const [prs, queue, recent, assigned] = await Promise.allSettled([
      collectPrs(state.worktrees),
      config.reviewQueue ? collectReviewQueue(config.reviewQueue) : Promise.resolve(null),
      collectRecentPrs(Date.now()),
      collectAssignedPrs(state.worktrees),
    ])

    if (assigned.status === 'fulfilled') state.assignedPrs = assigned.value

    if (recent.status === 'fulfilled') state.recentPrs = recent.value

    try {
      if (prs.status === 'rejected') throw prs.reason

      state.prs = prs.value
      state.prsAt = Date.now()
      delete state.errors.prs
    } catch (error) {
      state.errors.prs = error instanceof Error ? error.message : String(error)
    } finally {
      if (queue.status === 'fulfilled') {
        state.queue = queue.value
        delete state.errors.queue
      } else {
        state.errors.queue = queue.reason instanceof Error ? queue.reason.message : String(queue.reason)
      }

      prsJob = null
    }
  })())

export const getSnapshot = async (options: { force?: boolean } = {}): Promise<Snapshot> => {
  // Sessions take their titles, recaps and response counts from the transcript
  // scan, so the very first snapshot waits for that scan instead of showing
  // them empty until the next refresh.
  if (!usageAt) await refreshUsage()

  const now = Date.now()
  const worktreesStale = options.force || now - state.worktreesAt > WORKTREES_TTL_MS
  const prsStale = options.force || now - state.prsAt > PRS_TTL_MS

  if (worktreesStale) {
    const job = refreshWorktrees()

    if (!state.worktreesAt || options.force) await job
  }

  if (prsStale) {
    const job = refreshPrs()

    if (!state.prsAt || options.force) await job
  }

  if (options.force || now - state.jiraAt > JIRA_TTL_MS) {
    const job = refreshJira()

    if (!state.jiraAt || options.force) await job
  }

  if (options.force || now - usageAt > USAGE_TTL_MS) {
    const job = refreshUsage()

    if (options.force) await job
  }

  refreshSummary()

  const [favorites, names] = await Promise.all([readFavorites(), readNames()])
  const named = (session: Session): Session =>
    names[session.id] ? { ...session, name: names[session.id]!, claudeName: session.name, isAutoTitle: false } : session
  const briefing = state.briefing && {
    ...state.briefing,
    sessions: state.briefing.sessions.map(s => (names[s.id] ? { ...s, title: names[s.id]! } : s)),
  }

  return {
    ...state,
    sessions: state.sessions.map(named),
    briefing,
    favorites: favorites.map(f => f.id),
    favoriteSessions: favoriteSessionsOf(favorites, state.sessions).map(named),
    names,
    summary: currentSummary(),
    generatedAt: Date.now(),
  }
}

// Writes or refreshes the briefing's summary once the data it is made of has
// been read at least once: the transcripts, the pull requests and, when on, Jira.
export const refreshSummary = (options: { force?: boolean } = {}) => {
  if (!config.briefing) return ensureSummary(briefingInput(state, '', Date.now()), null)

  if (!usageAt || !state.prsAt || (config.jira && !state.jiraAt)) return

  ensureSummary(briefingInput(state, config.briefing.language, Date.now()), config.briefing, options)
}

// Checks the MCP servers again now, and rereads the rest of Claude's setup.
export const refreshKnowledge = async () => {
  state.knowledge = await collectKnowledge(REPOS[0] ?? '', { forceMcp: true })
}

// Gives a session a name in the console, or takes it away when name is empty.
export const renameSession = async (id: string, name: string) => {
  const known = state.sessions.some(s => s.id === id) || (await readFavorites()).some(f => f.id === id)

  if (!known) throw new Error('This session is not listed in the console.')

  return setName(id, name)
}

// Starred sessions no longer among the recent ones, as session rows: the name
// and folders kept when starred, with the title, recap and last activity the
// transcripts still hold.
const favoriteSessionsOf = (favorites: FavoriteSession[], recent: Session[]): Session[] => {
  const known = new Set(recent.map(s => s.id))

  return favorites
    .filter(f => !known.has(f.id))
    .map(f => ({
      id: f.id,
      name: f.name || renamedOf(f.id) || titleOf(f.id),
      isAutoTitle: !f.name && !renamedOf(f.id) && !!titleOf(f.id),
      responses: responsesOf(f.id),
      recap: recapOf(f.id).text,
      recapAt: recapOf(f.id).at,
      prUrls: prUrlsOf(f.id),
      branch: f.branch,
      model: '',
      top: f.top,
      dir: f.dir,
      resumeDir: f.resumeDir,
      ctx: 0,
      h5: null,
      h5Reset: '',
      h5ResetAt: null,
      d7: null,
      d7ResetAt: null,
      cost: null,
      seenAt: lastSeenOf(f.id) || f.addedAt,
      isLive: false,
      isRunning: false,
      runStatus: '',
      runSince: 0,
      remoteUrl: '',
    }))
}

// Stars a session, keeping what is needed to list and resume it later, or
// takes the star away. Returns the starred ids, newest first.
export const setFavorite = async (id: string, isFavorite: boolean) => {
  if (isFavorite) {
    const favorites = await readFavorites()
    const session = state.sessions.find(s => s.id === id) ?? favoriteSessionsOf(favorites, state.sessions).find(s => s.id === id)

    if (!session) throw new Error('This session is not listed in the console.')

    await addFavorite({
      id,
      name: session.isAutoTitle ? '' : session.name,
      branch: session.branch,
      top: session.top,
      dir: session.dir,
      resumeDir: session.resumeDir,
      addedAt: Date.now(),
    })
  } else {
    await removeFavorite(id)
  }

  return (await readFavorites()).map(f => f.id)
}

// Removes a dormant worktree's folder with `git worktree remove`. Unforced, git
// refuses when it holds modified or untracked files, so uncommitted work is
// never lost; forced, only after the person confirmed losing those files. The
// branch and its commits stay either way. Only a dormant worktree listed by git, other
// than the main checkout, with no dev server and no running session, qualifies.
export const removeDormantWorktree = async (path: string, force = false) => {
  await refreshWorktrees()

  const worktree = state.worktrees.find(w => w.path === path)

  if (!worktree || worktree.isMain) throw new Error('Not a worktree of this repository, or it is the main checkout.')
  if (worktree.activity !== 'dormant') throw new Error('Only dormant worktrees can be deleted from the console.')
  if (worktree.devServerPort) throw new Error(`A dev server runs from it on port ${worktree.devServerPort}.`)
  if (worktree.sessions.some(s => s.isRunning)) throw new Error('A Claude session is running in it.')

  try {
    await run('git', ['-C', worktree.repo, 'worktree', 'remove', ...(force ? ['--force'] : []), '--', path], { timeoutMs: 5 * 60_000 })
  } catch (error) {
    const message = (error as { stderr?: string }).stderr || (error instanceof Error ? error.message : String(error))

    throw new Error(message.replace(/^fatal:\s*/, '').trim())
  }

  await refreshWorktrees()
}

// Whether a path is one of the repositories' worktrees, as git lists them now.
export const isWorktreePath = async (path: string) => {
  const porcelains = await Promise.all(REPOS.map(repo => quiet(run('git', ['-C', repo, 'worktree', 'list', '--porcelain']), '')))

  return porcelains.some(porcelain => parseWorktreePorcelain(porcelain).some(entry => entry.path === path))
}

// The cost the status line last reported for a session, in US dollars.
export const sessionCost = async (sessionId: string): Promise<number | null> => {
  try {
    const raw = JSON.parse(await readFile(join(FLEET_DIR, `${sessionId}.json`), 'utf8')) as { cost?: unknown }

    return num(raw.cost)
  } catch {
    return null
  }
}
