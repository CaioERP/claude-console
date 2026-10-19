// The physics of the loading screen's emojis: each one hangs from its spot on
// a circle by a damped spring, so a push from the pointer moves it a little and
// it springs back.

export type Vec = { x: number; y: number }

export type Body = { offset: Vec; velocity: Vec }

export const ORBIT = {
  // How strongly the spring pulls back, and how quickly the bounce dies out.
  stiffness: 70,
  damping: 7,
  // The pointer pushes within this distance, harder the closer it is.
  pushRadius: 80,
  push: 5200,
  // An emoji never strays further than this from its spot.
  maxOffset: 46,
}

const length = (v: Vec) => Math.hypot(v.x, v.y)

// Advances one emoji by dt seconds: the spring toward its spot, damping, and a
// push away from the pointer when it is near.
export const step = (body: Body, spot: Vec, pointer: Vec | null, dt: number): Body => {
  const position = { x: spot.x + body.offset.x, y: spot.y + body.offset.y }
  let ax = -ORBIT.stiffness * body.offset.x - ORBIT.damping * body.velocity.x
  let ay = -ORBIT.stiffness * body.offset.y - ORBIT.damping * body.velocity.y

  if (pointer) {
    const away = { x: position.x - pointer.x, y: position.y - pointer.y }
    const distance = length(away)

    if (distance < ORBIT.pushRadius && distance > 0.001) {
      const strength = ORBIT.push * (1 - distance / ORBIT.pushRadius)

      ax += (away.x / distance) * strength
      ay += (away.y / distance) * strength
    }
  }

  let velocity = { x: body.velocity.x + ax * dt, y: body.velocity.y + ay * dt }
  let offset = { x: body.offset.x + velocity.x * dt, y: body.offset.y + velocity.y * dt }
  const stretch = length(offset)

  // At the end of its tether it stops moving outward, as if the band were taut.
  if (stretch > ORBIT.maxOffset) {
    const normal = { x: offset.x / stretch, y: offset.y / stretch }
    const outward = velocity.x * normal.x + velocity.y * normal.y

    offset = { x: normal.x * ORBIT.maxOffset, y: normal.y * ORBIT.maxOffset }

    if (outward > 0) velocity = { x: velocity.x - outward * normal.x, y: velocity.y - outward * normal.y }
  }

  return { offset, velocity }
}

// Where each of count emojis sits on a circle of radius around center, turned
// by angle radians.
export const spots = (count: number, center: Vec, radius: number, angle: number): Vec[] =>
  Array.from({ length: count }, (_, at) => {
    const theta = angle + (at * 2 * Math.PI) / count

    return { x: center.x + radius * Math.cos(theta), y: center.y + radius * Math.sin(theta) }
  })
