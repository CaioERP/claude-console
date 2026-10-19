import { useEffect, useMemo, useRef } from 'react'

import { type Body, type Vec, spots, step } from './orbit'

const EMOJIS = [
  '🤖', '✨', '🧠', '🚀', '⚡', '🌈', '🍕', '🐙', '🦄', '🎲', '🧩', '💡', '🌀', '🪐', '🎯', '🍩', '🐢', '🦊',
  '🐼', '🐔', '🐶', '🐱', '🌵', '🍄', '🎈', '🧃', '🛸', '🌻', '🍉', '🦕', '🐝', '🦋', '🌙', '⭐', '🍀', '🎧',
]
const COUNT = 10
const RADIUS = 118
const ORBIT_SPEED = 0.45
const STAGE = 340

const pickEmojis = () => {
  const pool = [...EMOJIS]

  return Array.from({ length: COUNT }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!)
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// The loading screen: random emojis circling an invisible ring, each spinning
// on its own axis. The pointer pushes the ones it passes near, a short way, and
// they spring back to the ring as if tied to it by an elastic band.
export const EmojiLoader = ({ message }: { message: string }) => {
  const emojis = useMemo(pickEmojis, [])
  const stage = useRef<HTMLDivElement>(null)
  const nodes = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    const center = { x: STAGE / 2, y: STAGE / 2 }
    const bodies: Body[] = emojis.map(() => ({ offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }))
    const spins = emojis.map(() => ({ angle: Math.random() * 360, speed: (60 + Math.random() * 140) * (Math.random() < 0.5 ? -1 : 1) }))
    let pointer: Vec | null = null
    let angle = Math.random() * Math.PI * 2
    let last = performance.now()
    let frame = 0

    const draw = () => {
      const places = spots(emojis.length, center, RADIUS, angle)

      places.forEach((spot, at) => {
        const node = nodes.current[at]
        const body = bodies[at]!

        if (node) {
          node.style.transform = `translate(${spot.x + body.offset.x}px, ${spot.y + body.offset.y}px) translate(-50%, -50%) rotate(${spins[at]!.angle}deg)`
        }
      })
    }

    const onMove = (event: PointerEvent) => {
      const box = stage.current?.getBoundingClientRect()

      pointer = box ? { x: event.clientX - box.left, y: event.clientY - box.top } : null
    }
    const onLeave = () => {
      pointer = null
    }

    if (reducedMotion()) {
      draw()

      return
    }

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000)

      last = now
      angle += ORBIT_SPEED * dt

      const places = spots(emojis.length, center, RADIUS, angle)

      places.forEach((spot, at) => {
        // Small steps keep the spring steady even when a frame runs long.
        for (let sub = 0; sub < 2; sub += 1) bodies[at] = step(bodies[at]!, spot, pointer, dt / 2)

        spins[at]!.angle += spins[at]!.speed * dt
      })

      draw()
      frame = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', onLeave)
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [emojis])

  return (
    <main className="emoji-loader" aria-busy="true">
      <div ref={stage} className="emoji-stage" style={{ width: STAGE, height: STAGE }} aria-hidden="true">
        {emojis.map((emoji, at) => (
          <span
            key={`${emoji}-${at}`}
            ref={node => {
              nodes.current[at] = node
            }}
            className="emoji-orbiter"
          >
            {emoji}
          </span>
        ))}
      </div>
      <p className="emoji-loader-message" role="status">
        {message}
      </p>
    </main>
  )
}
