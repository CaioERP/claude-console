import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { ConsoleFeatures } from '../shared/types'

// A host rule for naming the environment a dev server points at: a host equal
// to `match`, or containing it, is shown as `name`.
export type EnvRule = { match: string; name: string }

export type ConsoleConfig = {
  // The git repositories whose worktrees the console lists.
  repos: string[]
  brand: {
    // The name in the header and the window title.
    title: string
    // An SVG or PNG shown before the title, read from this machine. Optional.
    icon: string
  }
  // The terminal the console opens worktrees and resumes sessions in.
  terminal: Terminal
  // A listening process whose command line contains this text counts as the
  // worktree's dev server.
  devServer: { process: string }
  // Where a worktree keeps the URL its dev server talks to, and how to name it.
  devEnv: { files: string[]; key: string; rules: EnvRule[] } | null
  // Jira Cloud. Credentials come from JIRA_API_USER and JIRA_API_TOKEN.
  jira: { site: string; jql: string } | null
  // What the "+" beside the session search starts: a Claude Code session in the
  // repository whose first message is `prompt`, with {input} replaced by what
  // you type (a ticket or a name). Without it, the "+" starts an empty session.
  newSession: { prompt: string; inputLabel: string; description: string } | null
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

// The terminals the console can open tabs in, each with a desktop/<name>-tab script.
const TERMINALS = ['ghostty', 'terminator'] as const

export type Terminal = (typeof TERMINALS)[number]

export const CONFIG_DIR = join(homedir(), '.config', 'claude-console')

// The file accepts "repo" as one path or a list, and "repos" as a list.
type ConfigFile = Partial<Omit<ConsoleConfig, 'repos'>> & { repo?: string | string[]; repos?: string[] }

const DEFAULTS: ConsoleConfig = {
  repos: [],
  brand: { title: 'Claude Console', icon: '' },
  terminal: 'ghostty',
  devServer: { process: 'webpack' },
  devEnv: null,
  jira: null,
  newSession: null,
  reviewQueue: null,
}

const DEFAULT_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'

const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const readConfigFile = (): { path: string; values: ConfigFile } => {
  const path = process.env.CONSOLE_CONFIG || join(CONFIG_DIR, 'config.json')

  try {
    return { path, values: JSON.parse(readFileSync(path, 'utf8')) as ConfigFile }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, values: {} }

    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Fills in defaults, expands "~/", and lets CONSOLE_REPO (paths separated by
// ":") override the repositories.
export const resolveConfig = (values: ConfigFile, env: NodeJS.ProcessEnv = process.env): ConsoleConfig => {
  const listed = env.CONSOLE_REPO ? env.CONSOLE_REPO.split(':') : [values.repo ?? [], values.repos ?? []].flat()
  const repos = [...new Set(listed.map(r => r.trim()).filter(Boolean).map(r => resolve(expand(r))))]

  return {
    repos,
    brand: {
      title: values.brand?.title || DEFAULTS.brand.title,
      icon: values.brand?.icon ? resolve(expand(values.brand.icon)) : '',
    },
    terminal: values.terminal && TERMINALS.includes(values.terminal) ? values.terminal : DEFAULTS.terminal,
    devServer: { process: values.devServer?.process || DEFAULTS.devServer.process },
    devEnv: values.devEnv
      ? { files: values.devEnv.files ?? [], key: values.devEnv.key ?? '', rules: values.devEnv.rules ?? [] }
      : null,
    jira: values.jira?.site
      ? { site: values.jira.site.replace(/\/+$/, ''), jql: values.jira.jql || DEFAULT_JQL }
      : null,
    newSession: values.newSession?.prompt
      ? {
          prompt: values.newSession.prompt,
          inputLabel: values.newSession.inputLabel || 'Name',
          description: values.newSession.description || '',
        }
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
  newSession: c.newSession
    ? {
        needsInput: c.newSession.prompt.includes('{input}'),
        inputLabel: c.newSession.inputLabel,
        prompt: c.newSession.prompt,
        description: c.newSession.description,
      }
    : { needsInput: false, inputLabel: '', prompt: '', description: '' },
})

// What a new session's first message is: the configured prompt with {input}
// filled in. Input is limited to the characters of a ticket or a name, so what
// reaches the terminal is never more than that.
export const INPUT_PATTERN = /^[A-Za-z0-9._-]{1,80}$/

export const newSessionPrompt = (c: ConsoleConfig, input: string) => {
  if (!c.newSession) return ''

  if (!c.newSession.prompt.includes('{input}')) return c.newSession.prompt

  if (!INPUT_PATTERN.test(input)) throw new Error('Use only letters, numbers, ".", "-" and "_", up to 80 characters.')

  return c.newSession.prompt.replaceAll('{input}', input)
}
