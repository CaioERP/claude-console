import { describe, expect, it } from 'vitest'

import { keyIn, ticketHref } from './tickets'

describe('keyIn', () => {
  it('finds the ticket a branch or name refers to', () => {
    expect(keyIn('feature/ABC-10-x', ['ABC-1', 'ABC-10'])).toBe('ABC-10')
    expect(keyIn('ABC-1', ['XABC-1'])).toBeNull()
    expect(keyIn('', ['ABC-1'])).toBeNull()
  })
})

describe('ticketHref', () => {
  it('links to the ticket view', () => {
    expect(ticketHref('ABC-1')).toBe('?ticket=ABC-1')
  })
})
