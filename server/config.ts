import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { ConsoleFeatures } from '../shared/types'

// A host rule for naming the environment a dev server points at: a host equal
// to `match`, or containing it, is shown as `name`.
export type EnvRule = { match: string; name: string }

export type ConsoleConfig = {
  // The git repository whose worktrees the console lists.
  repo: string
  brand: {
    // The name in the header and the window title.
    title: string
    // An SVG or PNG shown before the title, read from this machine. Optional.
    icon: string
  }
  // A listening process whose command line contains this text counts as the
  // worktree's dev server.
  devServer: { process: string }
  // Where a worktree keeps the URL its dev server talks to, and how to name it.
  devEnv: { files: string[]; key: string; rules: EnvRule[] } | null
  // Jira Cloud. Credentials come from JIRA_API_USER and JIRA_API_TOKEN.
  jira: { site: string; jql: string } | null
  // A reviewer's queue that your pull requests are forwarded to, read with gh.
  reviewQueue: {
    // The repository the forwarded pull requests are opened in.
    repo: string
    // The reviewer's GitHub login and the name the console shows.
    reviewer: string
    name: string
    // A comment from the reviewer matching this (case-insensitive) means merged.
    mergedPattern: string
    // Forwarded branches end with this; {login} is your GitHub login.
    branchSuffix: string
  } | null
}

export const CONFIG_DIR = join(homedir(), '.config', 'claude-console')

const DEFAULTS: ConsoleConfig = {
  repo: '',
  brand: { title: 'Claude Console', icon: '' },
  devServer: { process: 'webpack' },
  devEnv: null,
  jira: null,
  reviewQueue: null,
}

const DEFAULT_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'

const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const readConfigFile = (): { path: string; values: Partial<ConsoleConfig> } => {
  const path = process.env.CONSOLE_CONFIG || join(CONFIG_DIR, 'config.json')

  try {
    return { path, values: JSON.parse(readFileSync(path, 'utf8')) as Partial<ConsoleConfig> }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, values: {} }

    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Fills in defaults, expands "~/", and lets CONSOLE_REPO override the repository.
export const resolveConfig = (values: Partial<ConsoleConfig>, env: NodeJS.ProcessEnv = process.env): ConsoleConfig => {
  const repo = env.CONSOLE_REPO || values.repo || DEFAULTS.repo

  return {
    repo: repo ? resolve(expand(repo)) : '',
    brand: {
      title: values.brand?.title || DEFAULTS.brand.title,
      icon: values.brand?.icon ? resolve(expand(values.brand.icon)) : '',
    },
    devServer: { process: values.devServer?.process || DEFAULTS.devServer.process },
    devEnv: values.devEnv
      ? { files: values.devEnv.files ?? [], key: values.devEnv.key ?? '', rules: values.devEnv.rules ?? [] }
      : null,
    jira: values.jira?.site
      ? { site: values.jira.site.replace(/\/+$/, ''), jql: values.jira.jql || DEFAULT_JQL }
      : null,
    reviewQueue: values.reviewQueue?.repo && values.reviewQueue.reviewer
      ? {
          repo: values.reviewQueue.repo,
          reviewer: values.reviewQueue.reviewer,
          name: values.reviewQueue.name || values.reviewQueue.reviewer,
          mergedPattern: values.reviewQueue.mergedPattern || '^merged\\b',
          branchSuffix: values.reviewQueue.branchSuffix || '',
        }
      : null,
  }
}

const loaded = readConfigFile()

export const CONFIG_PATH = loaded.path
export const config = resolveConfig(loaded.values)

// What the page needs to know about the configuration, and nothing else.
export const featuresOf = (c: ConsoleConfig): ConsoleFeatures => ({
  title: c.brand.title,
  hasIcon: !!c.brand.icon,
  jira: !!c.jira,
  reviewQueue: c.reviewQueue ? { name: c.reviewQueue.name, repo: c.reviewQueue.repo } : null,
})
