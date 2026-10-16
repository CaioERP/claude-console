import { join } from 'node:path'

import type { RepoConfig } from './config'

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
