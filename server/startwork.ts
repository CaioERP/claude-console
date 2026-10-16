import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { RepoConfig } from './config'
import { quiet, run } from './exec'
import { parseWorktreePorcelain } from './pure'

const TICKET_KEY = /^[A-Z][A-Z0-9]*-\d+$/

export const isTicketKey = (value: string) => TICKET_KEY.test(value)

// What git says about a repository, as far as starting a ticket in it goes.
export type RepoState = {
  worktrees: { path: string; branch: string }[]
  localBranches: string[]
  // Branches on the fork remote, origin, by their names without "origin/".
  forkBranches: string[]
  // Whether <worktreesDir>/<KEY> exists on disk.
  dirExists: boolean
}

export type WorktreePlan =
  | { kind: 'reuse'; path: string }
  | { kind: 'create'; path: string; from: 'branch' | 'fork' | 'base'; commands: string[][] }
  | { kind: 'blocked'; reason: string }

// Where a ticket's work happens in a repository and the git commands that get
// it there. Nothing is ever forced, reset or deleted: a branch already checked
// out is used where it is, an existing branch is checked out as it is, and only
// a branch that exists nowhere starts fresh, without tracking any remote.
export const planWorktree = (key: string, repo: RepoConfig, state: RepoState): WorktreePlan => {
  const checkedOut = state.worktrees.find(w => w.branch === key)

  if (checkedOut) return { kind: 'reuse', path: checkedOut.path }

  const path = join(repo.worktreesDir, key)

  if (state.dirExists) return { kind: 'blocked', reason: `${path} exists but is not a worktree of ${repo.name}.` }

  const git = (...args: string[]) => ['git', '-C', repo.path, ...args]

  if (state.localBranches.includes(key)) {
    return { kind: 'create', path, from: 'branch', commands: [git('worktree', 'add', path, key)] }
  }

  if (state.forkBranches.includes(key)) {
    return {
      kind: 'create',
      path,
      from: 'fork',
      commands: [git('worktree', 'add', '--no-track', '-b', key, path, `origin/${key}`)],
    }
  }

  if (!repo.base) return { kind: 'blocked', reason: `${repo.name} has no base branch configured.` }

  const { remote, branch } = repo.base

  return {
    kind: 'create',
    path,
    from: 'base',
    commands: [git('fetch', remote, branch), git('worktree', 'add', '--no-track', '-b', key, path, `${remote}/${branch}`)],
  }
}

type Git = (args: string[]) => Promise<string>

// What git says about a repository right now, for planning a ticket's worktree.
// The ticket's branch is fetched from the fork first, so work pushed from
// elsewhere is continued rather than replaced by a fresh branch.
export const readRepoState = async (
  repo: RepoConfig,
  key: string,
  git: Git = args => run('git', ['-C', repo.path, ...args], { timeoutMs: 60_000 }),
): Promise<RepoState> => {
  const read = (...args: string[]) => quiet(git(args), '')

  // Fails quietly when the fork has no such branch, which is the usual case.
  await read('fetch', 'origin', key)

  const [porcelain, local, fork, dirExists] = await Promise.all([
    read('worktree', 'list', '--porcelain'),
    read('branch', '--list', key, '--format=%(refname:short)'),
    read('branch', '-r', '--list', `origin/${key}`, '--format=%(refname:short)'),
    stat(join(repo.worktreesDir, key)).then(
      () => true,
      () => false,
    ),
  ])
  const lines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean)

  return {
    worktrees: parseWorktreePorcelain(porcelain).map(entry => ({ path: entry.path, branch: entry.branch })),
    localBranches: lines(local),
    forkBranches: lines(fork).map(name => name.replace(/^origin\//, '')),
    dirExists,
  }
}

export type StartResult = {
  repo: string
  path: string
  plan: WorktreePlan['kind'] | 'just-start'
  ok: boolean
  error?: string
}

export type StartDeps = {
  readState: (repo: RepoConfig, key: string) => Promise<RepoState>
  run: (argv: string[]) => Promise<unknown>
  open: (dir: string, prompt: string) => Promise<void>
  prompt: string
}

const messageOf = (error: unknown) =>
  ((error as { stderr?: string }).stderr || (error instanceof Error ? error.message : String(error))).trim()

// Starts a ticket in each repository on its own: one that fails, such as a
// fetch from an unreachable remote, reports its error and leaves the others
// to go on. A session opens only where the worktree is ready.
export const executeStart = (key: string, repos: RepoConfig[], deps: StartDeps): Promise<StartResult[]> =>
  Promise.all(
    repos.map(async (repo): Promise<StartResult> => {
      try {
        const plan = planWorktree(key, repo, await deps.readState(repo, key))

        if (plan.kind === 'blocked') return { repo: repo.name, path: '', plan: plan.kind, ok: false, error: plan.reason }

        if (plan.kind === 'create') {
          for (const argv of plan.commands) await deps.run(argv)
        }

        await deps.open(plan.path, deps.prompt)

        return { repo: repo.name, path: plan.path, plan: plan.kind, ok: true }
      } catch (error) {
        return { repo: repo.name, path: '', plan: 'create', ok: false, error: messageOf(error) }
      }
    }),
  )

export const startPrompt = (template: string, key: string) => template.replaceAll('{key}', key)
