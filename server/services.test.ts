import { describe, expect, it } from 'vitest'

import { parseDockerPs, servicesStatus, stackOf } from './services'

const line = (name: string, state: string, files: string, wd: string, project = 'p') =>
  JSON.stringify({
    Names: name,
    State: state,
    Ports: '0.0.0.0:5433->5432/tcp',
    CreatedAt: '2026-01-01 10:00:00 -0300 -03',
    Labels: `com.docker.compose.project=${project},com.docker.compose.project.config_files=${files},com.docker.compose.project.working_dir=${wd}`,
  })
const repos = [{ path: '/home/dev/app', name: 'App', base: null, worktreesDir: '/home/dev/app-worktrees', prRepos: null }]
const service = { name: 'Tests', file: '/home/dev/app/compose.test.yml' }

describe('parseDockerPs', () => {
  it('reads labels, keeping commas inside a value', () => {
    const [container] = parseDockerPs(line('db', 'running', '/home/dev/app/a.yml,/home/dev/app/b.yml', '/home/dev/app'))

    expect(container).toMatchObject({ name: 'db', state: 'running', ports: '0.0.0.0:5433->5432/tcp' })
    expect(container!.labels['com.docker.compose.project.config_files']).toBe('/home/dev/app/a.yml,/home/dev/app/b.yml')
  })
})

describe('stackOf', () => {
  it('finds the stack when a worktree started it', () => {
    const containers = parseDockerPs(
      line('db', 'running', '/home/dev/app-worktrees/ABC-1/compose.test.yml', '/home/dev/app-worktrees/ABC-1', 'abc-1'),
    )

    expect(stackOf(service, repos, containers)).toMatchObject({
      name: 'Tests',
      state: 'up',
      project: 'abc-1',
      isOwnCheckout: false,
      workingDir: '/home/dev/app-worktrees/ABC-1',
    })
  })

  it('knows a stack started from the configured checkout', () => {
    const containers = parseDockerPs(line('db', 'running', '/home/dev/app/compose.test.yml', '/home/dev/app'))

    expect(stackOf(service, repos, containers)).toMatchObject({ state: 'up', isOwnCheckout: true })
  })

  it('ignores the same file name from another repository', () => {
    const containers = parseDockerPs(line('db', 'running', '/home/dev/other/compose.test.yml', '/home/dev/other'))

    expect(stackOf(service, repos, containers)).toMatchObject({ state: 'down', containers: [] })
  })

  it('reports partial when only some containers run', () => {
    const files = '/home/dev/app/compose.test.yml'
    const containers = parseDockerPs([line('db', 'running', files, '/home/dev/app'), line('cache', 'exited', files, '/home/dev/app')].join('\n'))

    expect(stackOf(service, repos, containers).state).toBe('partial')
  })

  it('reports down when every container has exited', () => {
    const containers = parseDockerPs(line('db', 'exited', '/home/dev/app/compose.test.yml', '/home/dev/app'))

    expect(stackOf(service, repos, containers)).toMatchObject({ state: 'down', isOwnCheckout: true })
  })
})

describe('servicesStatus', () => {
  it('says Docker is unavailable instead of throwing', async () => {
    const failing = async () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'Cannot connect to the Docker daemon\nmore' })
    }

    await expect(servicesStatus(failing)).resolves.toEqual({
      available: false,
      reason: 'Cannot connect to the Docker daemon',
      stacks: [],
    })
  })
})
