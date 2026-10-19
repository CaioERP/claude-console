import { describe, expect, it } from 'vitest'

import { featuresOf, newSessionPrompt, resolveConfig } from './config'

describe('resolveConfig', () => {
  it('turns every optional integration off by default', () => {
    const config = resolveConfig({}, {})

    expect(config.repos).toEqual([])
    expect(config.brand).toEqual({ title: 'Claude Console', icon: '' })
    expect(config.devServer.process).toBe('webpack')
    expect(config.terminal).toBe('ghostty')
    expect([config.devEnv, config.jira, config.reviewQueue]).toEqual([null, null, null])
  })

  it('lets CONSOLE_REPO override the configured repositories', () => {
    expect(resolveConfig({ repo: '/a' }, { CONSOLE_REPO: '/b:/c' }).repos).toEqual(['/b', '/c'])
  })

  it('accepts one repository, a list, or both keys, without duplicates', () => {
    expect(resolveConfig({ repo: '/a' }, {}).repos).toEqual(['/a'])
    expect(resolveConfig({ repo: ['/a', '/b'] }, {}).repos).toEqual(['/a', '/b'])
    expect(resolveConfig({ repo: '/a', repos: ['/a/', '/b'] }, {}).repos).toEqual(['/a', '/b'])
  })

  it('accepts a known terminal and falls back to Ghostty otherwise', () => {
    expect(resolveConfig({ terminal: 'terminator' }, {}).terminal).toBe('terminator')
    expect(resolveConfig({ terminal: 'xterm' as never }, {}).terminal).toBe('ghostty')
  })

  it('reads repository objects with their Start Work settings', () => {
    const c = resolveConfig(
      {
        repo: ['/home/dev/plain', { path: '/home/dev/app', name: 'App', base: { remote: 'upstream', branch: 'main' } }] as never,
      },
      {},
    )

    expect(c.repos).toEqual(['/home/dev/plain', '/home/dev/app'])
    expect(c.repoConfigs[0]).toEqual({
      path: '/home/dev/plain',
      name: 'plain',
      base: null,
      worktreesDir: '/home/dev/plain-worktrees',
      prRepos: null,
    })
    expect(c.repoConfigs[1]).toMatchObject({
      name: 'App',
      base: { remote: 'upstream', branch: 'main' },
      worktreesDir: '/home/dev/app-worktrees',
    })
  })

  it('offers Start Work only for repositories with a base, and only when configured', () => {
    const values = {
      repo: ['/home/dev/a', { path: '/home/dev/b', name: 'B', base: { remote: 'u', branch: 'm' } }],
      startWork: { prompt: '/start {key}' },
    } as never

    expect(featuresOf(resolveConfig(values, {})).startWork).toEqual({ repos: ['B'] })
    expect(featuresOf(resolveConfig({ repo: '/home/dev/a' }, {})).startWork).toBeNull()
    expect(featuresOf(resolveConfig({ repo: '/home/dev/a', startWork: { prompt: '/start {key}' } } as never, {})).startWork).toBeNull()
  })

  it('resolves services and drops entries without a name or file', () => {
    const c = resolveConfig(
      { services: [{ name: 'Tests', file: '/home/dev/a/compose.yml' }, { name: '', file: '/x' }] } as never,
      {},
    )

    expect(c.services).toEqual([{ name: 'Tests', file: '/home/dev/a/compose.yml' }])
    expect(featuresOf(c).services).toBe(true)
  })

  it('fills in the Jira query and the review queue defaults', () => {
    const config = resolveConfig(
      { jira: { site: 'https://example.atlassian.net/', jql: '' }, reviewQueue: { repo: 'o/r', reviewer: 'rev' } as never },
      {},
    )

    expect(config.jira?.site).toBe('https://example.atlassian.net')
    expect(config.jira?.jql).toContain('currentUser()')
    expect(config.reviewQueue).toMatchObject({ name: 'rev', mergedPattern: '^merged\\b', branchSuffix: '' })
  })

  it('tells the page only what it shows', () => {
    const features = featuresOf(
      resolveConfig({ brand: { title: 'Mine', icon: '/x.svg' }, reviewQueue: { repo: 'o/r', reviewer: 'rev', name: 'Rev' } as never }, {}),
    )

    expect(features).toEqual({
      title: 'Mine',
      hasIcon: true,
      jira: false,
      reviewQueue: { name: 'Rev', repo: 'o/r' },
      newSession: { needsInput: false, inputLabel: '', prompt: '', description: '', environments: [] },
      startWork: null,
      services: false,
    })
  })
})

describe('newSessionPrompt', () => {
  const config = resolveConfig({ newSession: { prompt: '/setup {input}', inputLabel: 'Ticket' } as never }, {})

  it('fills the typed ticket or name into the first message', () => {
    expect(newSessionPrompt(config, 'ABC-12')).toBe('/setup ABC-12')
    expect(featuresOf(config).newSession).toEqual({ needsInput: true, inputLabel: 'Ticket', prompt: '/setup {input}', description: '', environments: [] })
  })

  it('refuses anything a terminal could read as more than a name', () => {
    for (const input of ['', 'a b', 'x;rm', '$(id)', 'a\nb', 'x'.repeat(81)]) {
      expect(() => newSessionPrompt(config, input)).toThrow()
    }
  })

  it('starts an empty session when nothing is configured', () => {
    expect(newSessionPrompt(resolveConfig({}, {}), 'ignored')).toBe('')
  })
})

describe('newSessionPrompt with an environment and a pull request', () => {
  const config = resolveConfig(
    {
      newSession: {
        prompt: '/setup {input} {env}',
        inputLabel: 'Ticket',
        description: '',
        environments: [{ label: 'STG', value: 'stg' }, { label: 'Bad', value: 'x; rm' }],
      },
    },
    {},
  )

  it('adds the chosen environment, or nothing when none is chosen', () => {
    expect(newSessionPrompt(config, 'ABC-1', 'stg')).toBe('/setup ABC-1 stg')
    expect(newSessionPrompt(config, 'ABC-1')).toBe('/setup ABC-1')
  })

  it('accepts a GitHub pull request link as the input', () => {
    expect(newSessionPrompt(config, 'https://github.com/o/r/pull/12', 'stg')).toBe('/setup https://github.com/o/r/pull/12 stg')
    expect(() => newSessionPrompt(config, 'https://evil.example/pull/1')).toThrow()
    expect(() => newSessionPrompt(config, 'https://github.com/o/r/pull/12;id')).toThrow()
  })

  it('refuses environments that are not configured, and drops unsafe ones from the config', () => {
    expect(() => newSessionPrompt(config, 'ABC-1', 'prod')).toThrow()
    expect(() => newSessionPrompt(config, 'ABC-1', 'x; rm')).toThrow()
  })
})
