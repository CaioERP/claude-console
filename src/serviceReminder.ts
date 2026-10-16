import type { ServiceStack, Session } from '../shared/types'

const REMINDER_AFTER_MS = 2 * 60 * 60 * 1000

// A stack left up for a while with no Claude session running is probably
// forgotten, holding memory and ports.
export const needsReminder = (stack: ServiceStack, sessions: Session[], now: number) =>
  stack.state !== 'down' &&
  stack.upSince !== null &&
  now - stack.upSince > REMINDER_AFTER_MS &&
  !sessions.some(s => s.isRunning)
