import { describe, expect, it } from 'vitest'

import { featuresOf, resolveConfig } from './config'

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

    expect(features).toEqual({ title: 'Mine', hasIcon: true, jira: false, reviewQueue: { name: 'Rev', repo: 'o/r' } })
  })
})
