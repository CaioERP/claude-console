import { describe, expect, it } from 'vitest'

import { ORBIT, spots, step, type Body } from './orbit'

const run = (body: Body, pointer: { x: number; y: number } | null, seconds: number) => {
  let current = body

  for (let t = 0; t < seconds; t += 1 / 60) current = step(current, { x: 0, y: 0 }, pointer, 1 / 60)

  return current
}

describe('orbit physics', () => {
  it('springs back to its spot after being pulled away', () => {
    const settled = run({ offset: { x: 30, y: -20 }, velocity: { x: 0, y: 0 } }, null, 4)

    expect(Math.hypot(settled.offset.x, settled.offset.y)).toBeLessThan(0.5)
  })

  it('is pushed away from a nearby pointer, but never past its tether', () => {
    const rest = { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }
    const pushed = run(rest, { x: -10, y: 0 }, 1)

    expect(pushed.offset.x).toBeGreaterThan(5)
    expect(Math.hypot(pushed.offset.x, pushed.offset.y)).toBeLessThanOrEqual(ORBIT.maxOffset + 1e-9)
  })

  it('ignores a pointer that is far away', () => {
    const rest = { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }

    expect(run(rest, { x: ORBIT.pushRadius * 3, y: 0 }, 1).offset).toEqual({ x: 0, y: 0 })
  })

  it('spreads the spots evenly around the circle', () => {
    const [a, b, c, d] = spots(4, { x: 0, y: 0 }, 10, 0)

    expect(a!.x).toBeCloseTo(10)
    expect(b!.y).toBeCloseTo(10)
    expect(c!.x).toBeCloseTo(-10)
    expect(d!.y).toBeCloseTo(-10)
  })
})
