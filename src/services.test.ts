import { describe, expect, it } from 'vitest'

import type { ServiceStack, Session } from '../shared/types'
import { needsReminder } from './serviceReminder'

const HOUR = 60 * 60 * 1000
const now = 10 * HOUR
const stack = (state: ServiceStack['state'], upFor: number): ServiceStack => ({
  name: 'Tests',
  state,
  project: 'p',
  workingDir: '/home/dev/app',
  isOwnCheckout: true,
  containers: [],
  upSince: state === 'down' ? null : now - upFor,
})
const session = (isRunning: boolean) => ({ isRunning }) as Session

describe('needsReminder', () => {
  it('reminds when a stack has been up over two hours with no session running', () => {
    expect(needsReminder(stack('up', 3 * HOUR), [session(false)], now)).toBe(true)
    expect(needsReminder(stack('partial', 3 * HOUR), [], now)).toBe(true)
  })

  it('stays quiet while a session runs, before two hours, or when down', () => {
    expect(needsReminder(stack('up', 3 * HOUR), [session(true)], now)).toBe(false)
    expect(needsReminder(stack('up', 1 * HOUR), [], now)).toBe(false)
    expect(needsReminder(stack('down', 0), [], now)).toBe(false)
  })
})
