import type { TicketDetail, TicketPr } from '../shared/types'
import { mentions } from '../src/format'
import { config, type RepoConfig } from './config'
import { quiet, run } from './exec'
import { fetchDescription } from './jira'
import { ciOf, toChecks, type RollupItem } from './pure'

const GITHUB_REMOTE = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/

// The owner/name of a GitHub remote, or null for any other host.
export const gitHubRepoOf = (remoteUrl: string) => {
  const match = GITHUB_REMOTE.exec(remoteUrl.trim())

  return match ? `${match[1]}/${match[2]}` : null
}

// The GitHub repositories a ticket's pull requests can live in: those behind
// each watched repository's remotes (fork, upstream and the rest), unless the
// repository names its own, plus the reviewer's queue.
export const prReposFor = (repos: RepoConfig[], remotesByPath: Map<string, string[]>, queueRepo: string | null) => {
  const found = repos.flatMap(repo =>
    repo.prRepos ?? (remotesByPath.get(repo.path) ?? []).map(gitHubRepoOf).filter((r): r is string => !!r),
  )

  return [...new Set(queueRepo ? [...found, queueRepo] : found)]
}

export type RawListedPr = {
  number: number
  title: string
  url: string
  headRefName: string
  author: { login: string } | null
  state: string
  createdAt: string
  statusCheckRollup: RollupItem[] | null
}

const stateOf = (state: string): TicketPr['state'] => {
  const lower = state.toLowerCase()

  return lower === 'merged' ? 'merged' : lower === 'open' ? 'open' : 'closed'
}

// One ticket's pull requests across repositories, oldest first so they read as
// the chain they were forwarded along; a repository that could not be read is
// named rather than hiding the rest.
export const mergePrChain = (
  key: string,
  lists: { repo: string; prs?: RawListedPr[]; error?: string }[],
): Pick<TicketDetail, 'prs' | 'prErrors'> => {
  const byUrl = new Map<string, TicketPr>()

  for (const list of lists) {
    for (const raw of list.prs ?? []) {
      if (byUrl.has(raw.url) || !(mentions(raw.title, key) || mentions(raw.headRefName, key))) continue

      const state = stateOf(raw.state)

      byUrl.set(raw.url, {
        repo: list.repo,
        number: raw.number,
        title: raw.title,
        url: raw.url,
        branch: raw.headRefName,
        author: raw.author?.login ?? '',
        state,
        createdAt: Date.parse(raw.createdAt) || 0,
        ci: state === 'open' ? ciOf(toChecks(raw.statusCheckRollup ?? [])) : 'none',
      })
    }
  }

  return {
    prs: [...byUrl.values()].sort((a, b) => a.createdAt - b.createdAt),
    prErrors: lists.filter(l => l.error).map(l => ({ repo: l.repo, error: l.error! })),
  }
}

const DETAIL_TTL_MS = 3 * 60_000
const PR_FIELDS = 'number,title,url,headRefName,author,state,createdAt,statusCheckRollup'

const cache = new Map<string, { at: number; detail: TicketDetail }>()

const remoteUrls = async (path: string) =>
  (await quiet(run('git', ['-C', path, 'remote', '-v']), ''))
    .split('\n')
    .map(line => line.split(/\s+/)[1] ?? '')
    .filter(Boolean)

const errorOf = (error: unknown) =>
  ((error as { stderr?: string }).stderr || (error instanceof Error ? error.message : String(error))).trim().split('\n')[0]!

// Everything the ticket view loads on demand: the description and the pull
// request chain, kept for a few minutes per ticket.
export const ticketDetail = async (key: string): Promise<TicketDetail> => {
  const hit = cache.get(key)

  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.detail

  const remotes = new Map(await Promise.all(config.repoConfigs.map(async r => [r.path, await remoteUrls(r.path)] as const)))
  const repos = prReposFor(config.repoConfigs, remotes, config.reviewQueue?.repo ?? null)
  const [description, lists] = await Promise.all([
    config.jira ? fetchDescription(config.jira, key).catch(error => `The description could not be read: ${errorOf(error)}`) : '',
    Promise.all(
      repos.map(repo =>
        run('gh', ['pr', 'list', '-R', repo, '--state', 'all', '--search', key, '--limit', '50', '--json', PR_FIELDS], {
          timeoutMs: 30_000,
        }).then(
          out => ({ repo, prs: JSON.parse(out) as RawListedPr[] }),
          error => ({ repo, error: errorOf(error) }),
        ),
      ),
    ),
  ])
  const detail = { key, description, ...mergePrChain(key, lists) }

  cache.set(key, { at: Date.now(), detail })

  return detail
}
