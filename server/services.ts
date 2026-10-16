import { dirname, join } from 'node:path'

import type { ServiceStack, ServicesStatus } from '../shared/types'
import { config, type RepoConfig, type ServiceConfig } from './config'
import { quiet, run } from './exec'

export type RawContainer = {
  name: string
  state: string
  ports: string
  labels: Record<string, string>
  startedAt: number | null
}

const CONFIG_FILES = 'com.docker.compose.project.config_files'
const PROJECT = 'com.docker.compose.project'
const WORKING_DIR = 'com.docker.compose.project.working_dir'

// Docker joins labels as k=v,k=v; a value can hold commas of its own, such as
// a list of compose files, so a piece without "=" belongs to the value before.
const parseLabels = (text: string) => {
  const labels: Record<string, string> = {}
  let last = ''

  for (const piece of text ? text.split(',') : []) {
    const at = piece.indexOf('=')

    if (at > 0) {
      last = piece.slice(0, at)
      labels[last] = piece.slice(at + 1)
    } else if (last) {
      labels[last] += `,${piece}`
    }
  }

  return labels
}

// The lines `docker ps -a --format '{{json .}}'` prints.
export const parseDockerPs = (text: string): RawContainer[] =>
  text
    .split('\n')
    .filter(line => line.trim().startsWith('{'))
    .map(line => {
      const raw = JSON.parse(line) as { Names?: string; State?: string; Ports?: string; Labels?: string }

      return {
        name: raw.Names ?? '',
        state: raw.State ?? '',
        ports: raw.Ports ?? '',
        labels: parseLabels(raw.Labels ?? ''),
        startedAt: null,
      }
    })

// Whether a compose file a container was started from is the configured one,
// in the repository's main checkout or in any of its worktrees.
const isSameFile = (file: string, service: ServiceConfig, repos: RepoConfig[]) => {
  const repo = repos.find(r => service.file.startsWith(`${r.path}/`))

  if (!repo) return file === service.file

  const relative = service.file.slice(repo.path.length + 1)

  if (file === join(repo.path, relative)) return true

  if (!file.startsWith(`${repo.worktreesDir}/`)) return false

  const inWorktree = file.slice(repo.worktreesDir.length + 1)

  return inWorktree.endsWith(`/${relative}`) && inWorktree.split('/').length === relative.split('/').length + 1
}

// A configured stack as Docker has it now, whichever checkout started it: a
// worktree's copy of the file is another compose project but the same
// containers and ports. The project with the most running containers wins.
export const stackOf = (service: ServiceConfig, repos: RepoConfig[], containers: RawContainer[]): ServiceStack => {
  const own = containers.filter(c => (c.labels[CONFIG_FILES] ?? '').split(',').some(file => isSameFile(file, service, repos)))
  const projects = [...new Set(own.map(c => c.labels[PROJECT] ?? ''))]
  const runningIn = (project: string) => own.filter(c => c.labels[PROJECT] === project && c.state === 'running').length
  const project = projects.sort((a, b) => runningIn(b) - runningIn(a))[0] ?? ''
  const members = own.filter(c => (c.labels[PROJECT] ?? '') === project)
  const running = members.filter(c => c.state === 'running')
  const workingDir = members[0]?.labels[WORKING_DIR] ?? ''
  const starts = running.map(c => c.startedAt).filter((at): at is number => at !== null)

  return {
    name: service.name,
    state: running.length === 0 ? 'down' : running.length === members.length ? 'up' : 'partial',
    project,
    workingDir,
    isOwnCheckout: !workingDir || workingDir === dirname(service.file),
    containers: members.map(c => ({ name: c.name, state: c.state, ports: c.ports, startedAt: c.startedAt })),
    upSince: starts.length > 0 ? Math.min(...starts) : null,
  }
}

type Runner = (cmd: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<string>

const firstLine = (error: unknown) =>
  ((error as { stderr?: string }).stderr || (error instanceof Error ? error.message : String(error))).trim().split('\n')[0]!

// The configured stacks, or why Docker could not be asked. It never throws, so
// a stopped daemon only shows in the Services panel.
export const servicesStatus = async (runner: Runner = run): Promise<ServicesStatus> => {
  let containers: RawContainer[]

  try {
    containers = parseDockerPs(await runner('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}']))
  } catch (error) {
    return { available: false, reason: firstLine(error), stacks: [] }
  }

  const stacks = config.services.map(s => stackOf(s, config.repoConfigs, containers))
  const running = stacks.flatMap(s => s.containers.filter(c => c.state === 'running').map(c => c.name))

  if (running.length > 0) {
    const started = await quiet(runner('docker', ['inspect', '-f', '{{.Name}} {{.State.StartedAt}}', ...running]), '')

    for (const line of started.split('\n')) {
      const [name = '', at = ''] = line.trim().split(' ')
      const container = containers.find(c => c.name === name.replace(/^\//, ''))

      if (container) container.startedAt = Date.parse(at) || null
    }
  }

  return { available: true, reason: '', stacks: config.services.map(s => stackOf(s, config.repoConfigs, containers)) }
}

const stackNamed = async (name: string) => {
  const service = config.services.find(s => s.name === name)

  if (!service) throw new Error(`Unknown service: ${name}`)

  const status = await servicesStatus()

  if (!status.available) throw new Error(`Docker is not available: ${status.reason}`)

  return { service, stack: status.stacks.find(s => s.name === name)! }
}

// Starts a stack from its configured file, unless another checkout's copy of
// it already holds the containers and ports.
export const startStack = async (name: string) => {
  const { service, stack } = await stackNamed(name)

  if (stack.state !== 'down' && !stack.isOwnCheckout) {
    throw new Error(`It already runs from ${stack.workingDir} (project ${stack.project}).`)
  }

  await run('docker', ['compose', '-f', service.file, 'up', '-d'], { cwd: dirname(service.file), timeoutMs: 10 * 60_000 })
}

// Tears down the project that is actually running the stack.
export const stopStack = async (name: string) => {
  const { stack } = await stackNamed(name)

  if (stack.state === 'down') throw new Error(`${name} is not running.`)

  await run('docker', ['compose', '-p', stack.project, 'down'], { timeoutMs: 5 * 60_000 })
}
