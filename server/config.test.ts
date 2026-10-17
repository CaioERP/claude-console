import { describe, expect, it } from 'vitest'

import { featuresOf, newSessionPrompt, resolveConfig } from './config'

describe('resolveConfig', () => {
  it('turns every optional integration off by default', () => {
    const config = resolveConfig({}, {})

    expect(config.repo).toBe('')
    expect(config.brand).toEqual({ title: 'Claude Console', icon: '' })
    expect(config.devServer.process).toBe('webpack')
    expect([config.devEnv, config.jira, config.reviewQueue]).toEqual([null, null, null])
  })

  it('lets CONSOLE_REPO override the configured repository', () => {
    expect(resolveConfig({ repo: '/a' }, { CONSOLE_REPO: '/b' }).repo).toBe('/b')
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
