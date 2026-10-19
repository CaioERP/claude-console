import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import type { ConsoleFeatures } from '../shared/types'

// A host rule for naming the environment a dev server points at: a host equal
// to `match`, or containing it, is shown as `name`.
export type EnvRule = { match: string; name: string }

// A watched repository and what Start Work needs to branch a ticket from it.
export type RepoConfig = {
  path: string
  name: string
  // The remote branch new ticket branches start from; without it, Start Work
  // does not offer this repository.
  base: { remote: string; branch: string } | null
  // Where a ticket's worktree goes: <worktreesDir>/<KEY>.
  worktreesDir: string
  // The GitHub repositories searched for a ticket's pull requests; by default,
  // those behind the repository's remotes.
  prRepos: string[] | null
}

// A Docker Compose stack the Services panel shows, by its file.
export type ServiceConfig = { name: string; file: string }

export type ConsoleConfig = {
  // The git repositories whose worktrees the console lists.
  repos: string[]
  repoConfigs: RepoConfig[]
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
  // {env} in the prompt is replaced by the chosen environment's value, or by
  // nothing when none is chosen.
  newSession: {
    prompt: string
    inputLabel: string
    description: string
    environments: Array<{ label: string; value: string }>
  } | null
  // The written summary at the top of the briefing, by Claude Code with the
  // daily-briefing skill. Off without this section, since each run uses your plan.
  briefing: { model: string; language: string; maxBudgetUsd: number } | null
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
  // What Start Work opens in each new worktree: a Claude Code session whose
  // first message is `prompt`, with {key} replaced by the ticket's key.
  startWork: { prompt: string } | null
  services: ServiceConfig[]
}

// The terminals the console can open tabs in, each with a desktop/<name>-tab script.
const TERMINALS = ['ghostty', 'terminator'] as const

export type Terminal = (typeof TERMINALS)[number]

export const CONFIG_DIR = join(homedir(), '.config', 'claude-console')

type RepoEntry = string | { path: string; name?: string; base?: RepoConfig['base']; worktreesDir?: string; prRepos?: string[] }

// The file accepts "repo" as one entry or a list, and "repos" as a list; an
// entry is a path, or an object with the path and its Start Work settings.
type ConfigFile = Partial<Omit<ConsoleConfig, 'repos' | 'repoConfigs'>> & { repo?: RepoEntry | RepoEntry[]; repos?: RepoEntry[] }

const DEFAULTS: ConsoleConfig = {
  repos: [],
  repoConfigs: [],
  brand: { title: 'Claude Console', icon: '' },
  terminal: 'ghostty',
  devServer: { process: 'webpack' },
  devEnv: null,
  jira: null,
  newSession: null,
  briefing: null,
  reviewQueue: null,
  startWork: null,
  services: [],
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
  const listed: RepoEntry[] = env.CONSOLE_REPO ? env.CONSOLE_REPO.split(':') : [values.repo ?? [], values.repos ?? []].flat()
  const repoConfigs = new Map<string, RepoConfig>()

  for (const entry of listed) {
    const raw = typeof entry === 'string' ? { path: entry } : entry
    const path = raw.path?.trim() ? resolve(expand(raw.path.trim())) : ''

    if (!path || repoConfigs.has(path)) continue

    repoConfigs.set(path, {
      path,
      name: raw.name || basename(path),
      base: raw.base?.remote && raw.base.branch ? { remote: raw.base.remote, branch: raw.base.branch } : null,
      worktreesDir: raw.worktreesDir ? resolve(expand(raw.worktreesDir)) : `${path}-worktrees`,
      prRepos: raw.prRepos?.length ? raw.prRepos : null,
    })
  }

  return {
    repos: [...repoConfigs.keys()],
    repoConfigs: [...repoConfigs.values()],
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
          environments: (values.newSession.environments ?? []).filter(e => e?.label && /^[a-z0-9-]+$/i.test(e.value ?? '')),
        }
      : null,
    briefing: values.briefing
      ? {
          model: values.briefing.model || 'haiku',
          language: values.briefing.language || 'English',
          maxBudgetUsd: values.briefing.maxBudgetUsd > 0 ? values.briefing.maxBudgetUsd : 0.1,
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
    startWork: values.startWork?.prompt ? { prompt: values.startWork.prompt } : null,
    services: (values.services ?? [])
      .filter(s => s?.name && s.file)
      .map(s => ({ name: s.name, file: resolve(expand(s.file)) })),
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
        environments: c.newSession.environments,
      }
    : { needsInput: false, inputLabel: '', prompt: '', description: '', environments: [] },
  // Start Work needs at least one repository with a base; without one, the
  // console keeps upstream's setup button.
  startWork:
    c.startWork && c.repoConfigs.some(r => r.base) ? { repos: c.repoConfigs.filter(r => r.base).map(r => r.name) } : null,
  services: c.services.length > 0,
})

// What a new session's first message is: the configured prompt with {input}
// and {env} filled in. Input is a ticket or a name, or a GitHub pull request's
// address, and the environment one of the configured values, so what reaches
// the terminal is never more than that.
export const INPUT_PATTERN = /^[A-Za-z0-9._-]{1,80}$/
export const PR_URL_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

export const newSessionPrompt = (c: ConsoleConfig, input: string, env = '') => {
  if (!c.newSession) return ''

  const { prompt, environments } = c.newSession

  if (env && !environments.some(e => e.value === env)) throw new Error('Not one of the configured environments.')

  if (prompt.includes('{input}') && !INPUT_PATTERN.test(input) && !PR_URL_PATTERN.test(input)) {
    throw new Error('Use a ticket or a name (letters, numbers, ".", "-" and "_"), or a GitHub pull request link.')
  }

  return prompt.replaceAll('{input}', input).replaceAll('{env}', env).replace(/\s+/g, ' ').trim()
}
