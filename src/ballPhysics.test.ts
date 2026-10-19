import { describe, expect, it } from 'vitest'

import { BALL, hitBall, newBall, stepBall, type Ball } from './ballPhysics'

const bounds = { left: 0, right: 300, floor: 28 }

const run = (ball: Ball, seconds: number) => {
  let current = ball

  for (let t = 0; t < seconds; t += 1 / 60) current = stepBall(current, bounds, 1 / 60)

  return current
}

describe('ball physics', () => {
  it('falls, bounces and comes to rest on the floor', () => {
    const rested = run(newBall(100, 0), 4)

    expect(rested.isResting).toBe(true)
    expect(rested.y).toBe(bounds.floor)
    expect(rested.x).toBe(100)
  })

  it('rolls to a stop when pushed along the floor', () => {
    const rolled = run({ ...newBall(100, bounds.floor), vx: 200 }, 4)

    expect(rolled.isResting).toBe(true)
    expect(rolled.x).toBeGreaterThan(130)
    expect(rolled.x).toBeLessThanOrEqual(bounds.right)
  })

  it('bounces off the walls instead of leaving the lane', () => {
    const fast = run({ ...newBall(280, bounds.floor), vx: 800 }, 3)

    expect(fast.x).toBeGreaterThanOrEqual(bounds.left)
    expect(fast.x).toBeLessThanOrEqual(bounds.right)
  })

  it('is knocked along the pointer when hit, and not when the pointer passes far away', () => {
    const resting = { ...newBall(100, bounds.floor), isResting: true }
    const hit = hitBall(resting, { x: 96, y: bounds.floor + BALL.size / 2 }, { x: 600, y: 0 }, 1000)

    expect(hit.isResting).toBe(false)
    expect(hit.vx).toBeGreaterThan(200)
    expect(hit.vy).toBeLessThan(0)
    expect(hitBall(resting, { x: 40, y: 0 }, { x: 600, y: 0 }, 1000)).toBe(resting)
  })

  it('ignores a second hit right after the first', () => {
    const hit = hitBall({ ...newBall(100, bounds.floor), isResting: true }, { x: 96, y: 30 }, { x: 600, y: 0 }, 1000)

    expect(hitBall(hit, { x: 96, y: 30 }, { x: 600, y: 0 }, 1050)).toBe(hit)
  })

  it('is not moved by a pointer barely moving over it', () => {
    const resting = { ...newBall(100, bounds.floor), isResting: true }

    expect(hitBall(resting, { x: 98, y: 30 }, { x: 20, y: 5 }, 1000)).toBe(resting)
  })
})
