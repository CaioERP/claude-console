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
      newSession: { needsInput: false, inputLabel: '', prompt: '', description: '' },
    })
  })
})

describe('newSessionPrompt', () => {
  const config = resolveConfig({ newSession: { prompt: '/setup {input}', inputLabel: 'Ticket' } as never }, {})

  it('fills the typed ticket or name into the first message', () => {
    expect(newSessionPrompt(config, 'ABC-12')).toBe('/setup ABC-12')
    expect(featuresOf(config).newSession).toEqual({ needsInput: true, inputLabel: 'Ticket', prompt: '/setup {input}', description: '' })
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
