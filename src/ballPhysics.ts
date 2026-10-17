// The pet's balls: they fall, bounce off the floor, the walls and the ceiling of
// the window bar, roll to a stop, and fly off when the pointer hits them.

export type Ball = { x: number; y: number; vx: number; vy: number; isResting: boolean; hitAt: number }

// x is the ball's center; y its top. left and right bound its center; floor is
// the highest y it can rest at.
export type Bounds = { left: number; right: number; floor: number }

export const BALL = {
  size: 9,
  gravity: 1400,
  // The share of speed kept on each bounce, off the floor and off the walls.
  bounce: 0.55,
  wallBounce: 0.7,
  // How fast rolling dies out on the floor, and in the air, per second.
  floorFriction: 3.2,
  airDrag: 0.4,
  // A hit: how close the pointer must pass, how much of its speed it gives,
  // the least kick, and how long before the same ball can be hit again.
  reach: 9,
  transfer: 0.55,
  minKick: 160,
  maxSpeed: 900,
  cooldownMs: 120,
  // A pointer slower than this is resting on the ball, not hitting it.
  minPointerSpeed: 90,
}

export const newBall = (x: number, y: number): Ball => ({ x, y, vx: 0, vy: 0, isResting: false, hitAt: 0 })

const clampSpeed = (v: number) => Math.max(-BALL.maxSpeed, Math.min(BALL.maxSpeed, v))

// Advances a ball by dt seconds.
export const stepBall = (ball: Ball, bounds: Bounds, dt: number): Ball => {
  if (ball.isResting) return ball

  let { x, y, vx, vy } = ball

  vy += BALL.gravity * dt
  x += vx * dt
  y += vy * dt

  if (y >= bounds.floor) {
    y = bounds.floor
    vy = Math.abs(vy) < 60 ? 0 : -vy * BALL.bounce
  } else if (y <= 0) {
    y = 0
    vy = Math.abs(vy) * BALL.bounce
  }

  if (x <= bounds.left) {
    x = bounds.left
    vx = Math.abs(vx) * BALL.wallBounce
  } else if (x >= bounds.right) {
    x = bounds.right
    vx = -Math.abs(vx) * BALL.wallBounce
  }

  const isOnFloor = y >= bounds.floor && vy === 0

  vx *= Math.max(0, 1 - (isOnFloor ? BALL.floorFriction : BALL.airDrag) * dt)

  const isResting = isOnFloor && Math.abs(vx) < 4

  return { ...ball, x, y, vx: isResting ? 0 : vx, vy, isResting }
}

// The pointer passing over a ball at the given speed knocks it away: along the
// pointer's motion and away from where it touched, with a small lift.
export const hitBall = (ball: Ball, pointer: { x: number; y: number }, velocity: { x: number; y: number }, now: number): Ball => {
  const center = { x: ball.x, y: ball.y + BALL.size / 2 }
  const dx = center.x - pointer.x
  const dy = center.y - pointer.y
  const distance = Math.hypot(dx, dy)

  if (distance > BALL.size / 2 + BALL.reach || now - ball.hitAt < BALL.cooldownMs) return ball
  if (Math.hypot(velocity.x, velocity.y) < BALL.minPointerSpeed) return ball

  const nx = distance > 0.001 ? dx / distance : Math.sign(velocity.x) || 1
  const ny = distance > 0.001 ? dy / distance : 0
  const speed = Math.max(BALL.minKick, Math.hypot(velocity.x, velocity.y) * BALL.transfer)

  return {
    ...ball,
    vx: clampSpeed(ball.vx + velocity.x * BALL.transfer + nx * speed * 0.5),
    vy: clampSpeed(ball.vy + velocity.y * BALL.transfer + ny * speed * 0.5 - 120),
    isResting: false,
    hitAt: now,
  }
}
