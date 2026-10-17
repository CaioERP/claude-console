import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'

import type { ClaudeKnowledge, Extension, Hook, Instruction, McpServer } from '../shared/types'
import { parseMcpLine, parseSkill } from './pure'
import { findClaude } from './summary'

const HOME = homedir()
const USER_DIR = join(HOME, '.claude')
const MCP_TTL_MS = 10 * 60_000
const MAX_BODY = 20_000

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

const listMd = async (dir: string) =>
  (await readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith('.md')).sort().map(f => join(dir, f))

const shortPath = (path: string, repo: string) =>
  repo && path.startsWith(`${repo}/`) ? relative(repo, path) : path.startsWith(`${HOME}/`) ? `~/${relative(HOME, path)}` : path

// MCP servers and their health, as `claude mcp list` checks them from the
// repository, where project servers apply too. It connects to each server, so
// the result is kept for ten minutes.
let mcp: ClaudeKnowledge['mcp'] = { servers: [], checkedAt: 0, error: '' }
let mcpJob: Promise<void> | null = null

const refreshMcp = (repo: string, force: boolean) => {
  if (mcpJob || (!force && Date.now() - mcp.checkedAt < MCP_TTL_MS)) return mcpJob

  mcpJob = (async () => {
    const claude = await findClaude()

    if (!claude) {
      mcp = { servers: [], checkedAt: Date.now(), error: 'Claude Code (the claude command) was not found.' }
      return
    }

    const output = await new Promise<string>(resolve => {
      execFile(claude, ['mcp', 'list'], { cwd: repo || HOME, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) =>
        resolve(String(stdout ?? '')),
      )
    })
    const servers = output
      .split('\n')
      .map(parseMcpLine)
      .filter((s): s is McpServer => s !== null)

    mcp = { servers, checkedAt: Date.now(), error: servers.length || /no mcp servers/i.test(output) ? '' : 'Could not read the MCP servers.' }
  })().finally(() => {
    mcpJob = null
  })

  return mcpJob
}

const instruction = async (path: string, scope: Instruction['scope'], repo: string): Promise<Instruction | null> => {
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || basename(path, '.md')
    const summary =
      body
        .split(/\n\s*\n/)
        .map(block => block.trim())
        .find(block => block && !block.startsWith('#') && !block.startsWith('```') && !block.startsWith('|'))
        ?.replace(/\s+/g, ' ') ?? ''

    return { scope, path: shortPath(path, repo), title, summary, body: body.slice(0, MAX_BODY), updatedAt: info.mtimeMs }
  } catch {
    return null
  }
}

// The instruction files Claude Code reads: CLAUDE.md files and rules, yours
// and the repository's.
const collectInstructions = async (repo: string) => {
  const files: Array<[string, Instruction['scope']]> = [
    [join(USER_DIR, 'CLAUDE.md'), 'user'],
    ...(await listMd(join(USER_DIR, 'rules'))).map(f => [f, 'user'] as [string, Instruction['scope']]),
  ]

  if (repo) {
    files.push([join(repo, 'CLAUDE.md'), 'project'], [join(repo, '.claude', 'CLAUDE.md'), 'project'])
    files.push(...(await listMd(join(repo, '.claude', 'rules'))).map(f => [f, 'project'] as [string, Instruction['scope']]))
  }

  return (await Promise.all(files.map(([path, scope]) => instruction(path, scope, repo)))).filter(
    (i): i is Instruction => i !== null,
  )
}

type Settings = {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string }> }>>
  enabledPlugins?: Record<string, boolean>
  env?: Record<string, string>
}

const settingsFiles = (repo: string): Array<[string, Hook['scope']]> => [
  [join(USER_DIR, 'settings.json'), 'user'],
  ...(repo
    ? ([
        [join(repo, '.claude', 'settings.json'), 'project'],
        [join(repo, '.claude', 'settings.local.json'), 'local'],
      ] as Array<[string, Hook['scope']]>)
    : []),
]

const collectHooks = async (repo: string): Promise<Hook[]> => {
  const hooks: Hook[] = []

  for (const [path, scope] of settingsFiles(repo)) {
    const settings = await readJson<Settings>(path)

    for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
      for (const group of groups ?? []) {
        for (const hook of group.hooks ?? []) {
          hooks.push({ scope, event, matcher: group.matcher ?? '', command: shortPath(hook.command ?? hook.type ?? '', repo) })
        }
      }
    }
  }

  return hooks
}

// A marketplace plugin's description, from the newest cached copy of it.
const pluginDescription = async (name: string, marketplace: string) => {
  const dir = join(USER_DIR, 'plugins', 'cache', marketplace, name)
  const versions = (await readdir(dir).catch(() => [] as string[])).sort().reverse()

  for (const version of versions) {
    const manifest = await readJson<{ description?: string }>(join(dir, version, '.claude-plugin', 'plugin.json'))

    if (manifest) return manifest.description ?? ''
  }

  return ''
}

const markdownItems = async (dir: string, kind: Extension['kind'], scope: Extension['scope']): Promise<Extension[]> =>
  Promise.all(
    (await listMd(dir)).map(async path => {
      const meta = parseSkill(await readFile(path, 'utf8').catch(() => ''))

      return { kind, scope, name: meta.name || basename(path, '.md'), description: meta.description, isEnabled: true }
    }),
  )

// Plugins from the marketplaces and from local folders, slash commands, and
// subagents: yours and the repository's.
const collectExtensions = async (repo: string): Promise<Extension[]> => {
  const extensions: Extension[] = []

  for (const [path, scope] of settingsFiles(repo)) {
    const settings = await readJson<Settings>(path)
    const pluginScope = scope === 'user' ? 'user' : 'project'

    for (const [id, isEnabled] of Object.entries(settings?.enabledPlugins ?? {})) {
      const [name = id, marketplace = ''] = id.split('@')

      extensions.push({ kind: 'plugin', scope: pluginScope, name, description: await pluginDescription(name, marketplace), isEnabled })
    }

    for (const dir of (settings?.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(':').filter(Boolean)) {
      const full = dir.startsWith('~/') ? join(HOME, dir.slice(2)) : dir
      const manifest = await readJson<{ name?: string; description?: string }>(join(full, '.claude-plugin', 'plugin.json'))

      if (manifest) {
        extensions.push({ kind: 'local plugin', scope: pluginScope, name: manifest.name ?? basename(full), description: manifest.description ?? '', isEnabled: true })
      }
    }
  }

  extensions.push(...(await markdownItems(join(USER_DIR, 'commands'), 'command', 'user')))
  extensions.push(...(await markdownItems(join(USER_DIR, 'agents'), 'agent', 'user')))

  if (repo) {
    extensions.push(...(await markdownItems(join(repo, '.claude', 'commands'), 'command', 'project')))
    extensions.push(...(await markdownItems(join(repo, '.claude', 'agents'), 'agent', 'project')))
  }

  return extensions
}

export const collectKnowledge = async (repo: string, options: { forceMcp?: boolean } = {}): Promise<ClaudeKnowledge> => {
  const job = refreshMcp(repo, !!options.forceMcp)

  // The first check waits, so the panel does not start empty, and so does one
  // asked for; the others refresh in the background.
  if (job && (!mcp.checkedAt || options.forceMcp)) await job

  const [instructions, hooks, extensions] = await Promise.all([
    collectInstructions(repo),
    collectHooks(repo),
    collectExtensions(repo),
  ])

  return { mcp, instructions, hooks, extensions }
}
