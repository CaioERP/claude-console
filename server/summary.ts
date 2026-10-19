import { spawn } from 'node:child_process'
import { access, constants, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import type { BriefingSummary } from '../shared/types'
import { type BriefingInput, inputHash } from './briefing-input'
import { CONFIG_DIR, type ConsoleConfig } from './config'

const DIR = join(CONFIG_DIR, 'briefing')
const OVERRIDE = join(CONFIG_DIR, 'daily-briefing.md')
const KEEP_DAYS = 14
const TIMEOUT_MS = 90_000
// Within a day, new data rewrites the summary at most this often.
const MIN_GAP_MS = 30 * 60_000

type Cached = { date: string; hash: string; text: string; generatedAt: number; model: string; costUsd: number | null }

let summary: BriefingSummary = { status: 'off', text: '', generatedAt: 0, model: '', error: '' }
let cached: Cached | null = null
let running: Promise<void> | null = null
let failedAt = 0

// After a failed run, wait this long before trying again on its own.
const RETRY_MS = 10 * 60_000

export const currentSummary = () => summary

const isExecutable = (path: string) => access(path, constants.X_OK).then(() => true, () => false)

// The service's PATH is short, and Claude Code usually lives in ~/.local/bin.
export const findClaude = async () => {
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.claude', 'local'),
  ].filter(Boolean)

  for (const dir of dirs) {
    if (await isExecutable(join(dir, 'claude'))) return join(dir, 'claude')
  }

  return ''
}

const readCached = async (date: string): Promise<Cached | null> => {
  try {
    return JSON.parse(await readFile(join(DIR, `${date}.json`), 'utf8')) as Cached
  } catch {
    return null
  }
}

const writeCached = async (entry: Cached) => {
  await mkdir(DIR, { recursive: true, mode: 0o700 })
  await writeFile(join(DIR, `${entry.date}.json.tmp`), `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 })
  await rename(join(DIR, `${entry.date}.json.tmp`), join(DIR, `${entry.date}.json`))

  const old = (await readdir(DIR).catch(() => [] as string[])).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()

  await Promise.all(old.slice(0, Math.max(0, old.length - KEEP_DAYS)).map(f => rm(join(DIR, f), { force: true })))
}

const show = (entry: Cached) => {
  cached = entry
  summary = { status: 'ready', text: entry.text, generatedAt: entry.generatedAt, model: entry.model, error: '' }
}

// Runs the daily-briefing skill headlessly: no tools, no saved session, none of
// your hooks or plugins, a hard budget, and the input on standard input. The skill comes from the console's
// own .claude folder, which is why it runs from the console's directory.
const write = async (input: BriefingInput, hash: string, setup: NonNullable<ConsoleConfig['briefing']>) => {
  const claude = await findClaude()

  if (!claude) throw new Error('Claude Code (the claude command) was not found.')

  const args = [
    '-p', '/daily-briefing',
    '--model', setup.model,
    '--tools', '',
    '--no-session-persistence',
    // Only the console's own settings: your hooks, plugins and personal
    // settings stay out of the summary.
    '--setting-sources', 'project',
    '--max-budget-usd', String(setup.maxBudgetUsd),
    '--output-format', 'json',
  ]

  if (await access(OVERRIDE).then(() => true, () => false)) {
    args.push('--append-system-prompt-file', OVERRIDE)
  }

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(claude, args, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS)
    let out = ''
    let err = ''

    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (err += chunk))
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || `claude exited with ${code}`))
    })
    child.stdin.end(JSON.stringify(input))
  })

  const result = JSON.parse(output) as { result?: string; is_error?: boolean; total_cost_usd?: number }
  const text = (result.result ?? '').trim()

  if (result.is_error || !text) throw new Error(text || 'Claude returned no summary.')

  const entry: Cached = {
    date: input.today,
    hash,
    text,
    generatedAt: Date.now(),
    model: setup.model,
    costUsd: result.total_cost_usd ?? null,
  }

  await writeCached(entry)
  show(entry)
}

// Keeps the summary current: today's cached one when its input is unchanged,
// otherwise a new one, at most one run at a time. A new day always gets a new
// summary; within a day, changed data rewrites it at most every half hour,
// unless forced.
export const ensureSummary = (
  input: BriefingInput,
  setup: ConsoleConfig['briefing'],
  options: { force?: boolean } = {},
) => {
  if (!setup) {
    summary = { status: 'off', text: '', generatedAt: 0, model: '', error: '' }
    return
  }

  if (running || (!options.force && Date.now() - failedAt < RETRY_MS)) return

  // Cleared in .finally, never inside the body: a body that returns before its
  // first await would clear the flag before it was even set.
  running = (async () => {
    const hash = inputHash(input)

    try {
      if (!cached || cached.date !== input.today) {
        const stored = await readCached(input.today)

        if (stored) show(stored)
      }

      const isCurrent = cached?.date === input.today && cached.hash === hash
      const isRecent = cached?.date === input.today && Date.now() - cached.generatedAt < MIN_GAP_MS

      if (!options.force && (isCurrent || (isRecent && summary.status === 'ready'))) return

      summary = { ...summary, status: 'writing', error: '' }
      await write(input, hash, setup)
      failedAt = 0
    } catch (error) {
      failedAt = Date.now()
      summary = { ...summary, status: summary.text ? 'ready' : 'error', error: error instanceof Error ? error.message : String(error) }
    }
  })().finally(() => {
    running = null
  })
}
