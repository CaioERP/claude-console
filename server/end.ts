import { readFile } from 'node:fs/promises'

import { runningSessions } from './collect'
import { procStartOf } from './pure'

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'nu'])
const TERMINALS = new Set(['ghostty'])

export type TabPlan = { closeTab: true } | { closeTab: false; reason: string }

// Whether ending a session may also close its terminal tab: only when Claude
// Code runs straight in a shell that runs straight in Ghostty, and the shell
// has nothing else running, such as a dev server, that closing would kill.
export const tabPlan = (shell: string, terminal: string, others: string[]): TabPlan => {
  if (!SHELLS.has(shell)) return { closeTab: false, reason: `it runs under ${shell || 'an unknown process'}, not a shell` }
  if (!TERMINALS.has(terminal)) return { closeTab: false, reason: `its shell runs in ${terminal || 'an unknown process'}, not Ghostty` }
  if (others.length > 0) return { closeTab: false, reason: `${others.join(', ')} still runs in it` }

  return { closeTab: true }
}

const statOf = async (pid: number) => {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
  const close = stat.lastIndexOf(')')

  return stat
    ? { comm: stat.slice(stat.indexOf('(') + 1, close), ppid: Number(stat.slice(close + 2).split(' ')[1]), start: procStartOf(stat) }
    : null
}

const childrenOf = async (pid: number) =>
  (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => ''))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)

const isAlive = async (pid: number, start: string) => (await statOf(pid))?.start === start

const waitForExit = async (pid: number, start: string, ms: number) => {
  for (let waited = 0; waited < ms; waited += 100) {
    if (!(await isAlive(pid, start))) return true

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return !(await isAlive(pid, start))
}

// Ends a running Claude Code session and closes the Ghostty tab it runs in.
// The conversation stays on disk, so it can be resumed later.
export const endSession = async (sessionId: string): Promise<{ closedTab: boolean; note: string }> => {
  const proc = (await runningSessions())?.get(sessionId)

  if (!proc) throw new Error('This session is not running.')

  const claude = await statOf(proc.pid)

  if (!claude) throw new Error('This session is not running.')

  const shell = await statOf(claude.ppid)
  const terminal = shell ? await statOf(shell.ppid) : null

  process.kill(proc.pid, 'SIGTERM')

  if (!(await waitForExit(proc.pid, claude.start, 5_000))) {
    throw new Error('Claude Code did not exit within 5 seconds; nothing else was closed.')
  }

  if (!shell) return { closedTab: false, note: 'Ended the session.' }

  const others = await Promise.all((await childrenOf(claude.ppid)).map(async pid => (await statOf(pid))?.comm ?? String(pid)))
  const plan = tabPlan(shell.comm, terminal?.comm ?? '', others)

  if (!plan.closeTab) return { closedTab: false, note: `Ended the session; kept its terminal because ${plan.reason}.` }

  // The shell is still the one that ran Claude Code: same pid, same start time.
  if (!(await isAlive(claude.ppid, shell.start))) return { closedTab: true, note: 'Ended the session.' }

  process.kill(claude.ppid, 'SIGHUP')

  return { closedTab: true, note: 'Ended the session and closed its Ghostty tab.' }
}
