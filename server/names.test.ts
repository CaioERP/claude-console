import { describe, expect, it } from 'vitest'

import { MAX_NAME, cleanName } from './names'
import { parseCustomTitle } from './pure'

describe('parseCustomTitle', () => {
  const id = '00000000-0000-4000-8000-000000000001'

  it('reads the name /rename gave, from either kind of row', () => {
    expect(parseCustomTitle(JSON.stringify({ type: 'agent-name', agentName: 'Fix the build', sessionId: id }))).toEqual({
      sessionId: id,
      title: 'Fix the build',
    })
    expect(parseCustomTitle(JSON.stringify({ type: 'custom-title', customTitle: 'Old style', sessionId: id }))).toEqual({
      sessionId: id,
      title: 'Old style',
    })
  })

  it('ignores other rows, even when they quote a row type', () => {
    expect(parseCustomTitle(JSON.stringify({ type: 'user', message: '"agent-name"', sessionId: id }))).toBeNull()
    expect(parseCustomTitle('{"type":"agent-name"')).toBeNull()
  })
})

describe('cleanName', () => {
  it('keeps a name to one tidy line', () => {
    expect(cleanName('  Fix\n the\tbuild  ')).toBe('Fix the build')
    expect(cleanName('\u0007')).toBe('')
    expect(cleanName('x'.repeat(200))).toHaveLength(MAX_NAME)
  })
})
