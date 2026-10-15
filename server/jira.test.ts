import { describe, expect, it } from 'vitest'

import { toIssue } from './jira'
import { isOpenable, isSessionId } from './open'

describe('toIssue', () => {
  it('maps a search result to the fields the console shows', () => {
    expect(
      toIssue({
        key: 'ABC-1042',
        fields: {
          summary: 'Let the sidebar push the page content',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          issuetype: { name: 'Technical Task' },
          priority: { name: 'Low' },
          updated: '2026-10-14T18:00:00.000-0300',
          parent: { key: 'ABC-1001', fields: { summary: 'Editor layout' } },
        },
      }, 'https://example.atlassian.net'),
    ).toEqual({
      key: 'ABC-1042',
      summary: 'Let the sidebar push the page content',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      type: 'Technical Task',
      priority: 'Low',
      updatedAt: Date.parse('2026-10-14T18:00:00.000-0300'),
      parentKey: 'ABC-1001',
      parentSummary: 'Editor layout',
      url: 'https://example.atlassian.net/browse/ABC-1042',
    })
  })

  it('tolerates a ticket without parent or priority', () => {
    const issue = toIssue({
      key: 'ABC-1',
      fields: {
        summary: 's',
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        issuetype: { name: 'Bug' },
        priority: null,
        updated: '2026-10-14T18:00:00.000Z',
        parent: null,
      },
    }, 'https://example.atlassian.net')

    expect([issue.priority, issue.parentKey]).toEqual(['', ''])
  })
})

describe('isOpenable', () => {
  it('opens web and Ghostty links only', () => {
    expect(isOpenable('https://github.com/x')).toBe(true)
    expect(isOpenable('http://localhost:3000')).toBe(true)
    expect(isOpenable('ghosttycd:///home/dev/repo')).toBe(true)
    expect(isOpenable('file:///etc/passwd')).toBe(false)
    expect(isOpenable('javascript:alert(1)')).toBe(false)
  })
})

describe('isSessionId', () => {
  it('accepts Claude Code session ids only', () => {
    expect(isSessionId('00000000-0000-4000-8000-000000000001')).toBe(true)
    expect(isSessionId('00000000; rm -rf ~')).toBe(false)
    expect(isSessionId('')).toBe(false)
  })
})
