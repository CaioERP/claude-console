import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import type {
  PetOptions,
  PetSettings,
  Pet,
  DiskUsage,
  ClaudeKnowledge,
  Extension,
  Instruction,
  McpServer,
  Skill,
  Battery,
  Activity,
  ReviewQueue,
  Briefing,
  Contributions,
  JiraIssue,
  MemoryNote,
  PublishedArtifact,
  LiveResponse,
  LiveStatus,
  PullRequest,
  QueuedPr,
  Session,
  Snapshot,
  Usage,
  UsageWindow,
  Worktree,
} from '../shared/types'
import {
  ago,
  blend,
  compact,
  elapsedLabel,
  greeting,
  memoryKey,
  memoryLinks,
  mentions,
  orderStatuses,
  plural,
  prBelongsTo,
  quartileScale,
  resumeCommand,
  sessionMatches,
  spinnerFrame,
  until,
  verbFor,
  worktreeOf,
  briefingPrs,
  bytesLabel,
  summaryParagraphs,
  type SummaryToken,
  type BriefPr,
  type PrEvent,
} from './format'
import { BALL, type Ball, hitBall, newBall, stepBall } from './ballPhysics'
import { EmojiLoader } from './EmojiLoader'
import { MemoryGraph } from './MemoryGraph'
import { useScrollEdges } from './scrollEdges'
import { ServicesPanel } from './Services'
import { StartWorkButton } from './StartWork'
import { TicketChip, TicketLink, TicketView } from './TicketView'
import { TicketKeys, useTicketHistory, useTicketParam } from './tickets'

const POLL_MS = 10_000
const THEME_KEY = 'claude-console:theme'

type Theme = 'system' | 'light' | 'dark'

const readTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_KEY)

    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

const SYSTEM_POLL_MS = 30_000
const SYSTEM_REFRESH = 'claude-console:system-refresh'

const useSystem = () => {
  const [system, setSystem] = useState<{ battery: Battery | null; disk: DiskUsage | null; pet: Pet | null }>({
    battery: null,
    disk: null,
    pet: null,
  })

  useEffect(() => {
    let isActive = true

    const load = async () => {
      try {
        const response = await fetch('/api/system')

        if (response.ok && isActive) setSystem((await response.json()) as { battery: Battery | null; disk: DiskUsage | null; pet: Pet | null })
      } catch {
        // Keep the last reading until the server answers again.
      }
    }

    void load()
    const timer = setInterval(() => void load(), SYSTEM_POLL_MS)
    const onRefresh = () => void load()

    window.addEventListener(SYSTEM_REFRESH, onRefresh)

    return () => {
      isActive = false
      clearInterval(timer)
      window.removeEventListener(SYSTEM_REFRESH, onRefresh)
    }
  }, [])

  return system
}

// The wall clock, ticking over exactly on each new minute.
const useClock = () => {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const schedule = () => {
      timer = setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, 60_000 - (Date.now() % 60_000) + 50)
    }

    schedule()

    return () => clearTimeout(timer)
  }, [])

  return now
}

const batteryLevel = (battery: Battery) =>
  battery.isCharging || battery.isPluggedIn ? 'ok' : battery.percent <= 15 ? 'critical' : battery.percent <= 30 ? 'low' : 'ok'

const BatteryMeter = ({ battery }: { battery: Battery }) => {
  const state = battery.isCharging ? 'charging' : battery.isPluggedIn ? 'plugged in' : 'on battery'

  return (
    <span className="win-battery" data-level={batteryLevel(battery)} data-tooltip={`Battery ${battery.percent}%, ${state}`}>
      <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
        <rect x="0.5" y="0.5" width="20" height="11" rx="2.5" fill="none" stroke="currentColor" opacity="0.55" />
        <rect x="21.5" y="3.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.55" />
        <rect className="win-battery-fill" x="2" y="2" width={(17 * battery.percent) / 100} height="8" rx="1.5" />
        {battery.isCharging && (
          <path d="M11.6 1.5 7.4 6.6h3l-.9 3.9 4.2-5.1h-3z" fill="var(--ink)" stroke="var(--surface)" strokeWidth="0.8" paintOrder="stroke" />
        )}
      </svg>
      <span>{battery.percent}%</span>
      <span className="visually-hidden">, {state}</span>
    </span>
  )
}

const percent = (part: number, whole: number) => {
  const share = whole > 0 ? (part / whole) * 100 : 0

  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`
}

// A slice of a 16px pie from one share of the circle to another, starting at
// twelve o'clock and going clockwise.
const pieSlice = (from: number, to: number) => {
  const point = (share: number) => {
    const angle = share * 2 * Math.PI - Math.PI / 2

    return `${(8 + 7 * Math.cos(angle)).toFixed(2)} ${(8 + 7 * Math.sin(angle)).toFixed(2)}`
  }

  if (to - from >= 0.9999) return 'M8 1a7 7 0 1 1 0 14a7 7 0 1 1 0-14Z'

  return `M8 8L${point(from)}A7 7 0 ${to - from > 0.5 ? 1 : 0} 1 ${point(to)}Z`
}

// The disk as a mini pie: the worktrees' share in the accent color, the rest
// of what is used in neutral gray, and the free space as the empty track.
const DiskPie = ({ usage }: { usage: DiskUsage }) => {
  const size = usage.disk?.size ?? 0
  const worktrees = size ? Math.min(1, usage.totalBytes / size) : 0
  const used = size ? Math.min(1, Math.max(worktrees, usage.disk!.used / size)) : 0

  return (
    <svg className="disk-pie" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="disk-pie-free" cx="8" cy="8" r="7" />
      {used > worktrees && <path className="disk-pie-other" d={pieSlice(worktrees, used)} />}
      {worktrees > 0 && <path className="disk-pie-worktrees" d={pieSlice(0, worktrees)} />}
    </svg>
  )
}

const worktreeName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

// What the worktrees take on disk, with the largest ones and the disk's free
// space in its tooltip. It turns red when the disk is almost full.
const WorktreeDisk = ({ usage }: { usage: DiskUsage }) => {
  const freeShare = usage.disk ? usage.disk.free / usage.disk.size : 1
  const level = freeShare < 0.1 ? 'critical' : freeShare < 0.2 ? 'low' : 'ok'
  const largest = usage.worktrees
    .slice(0, 5)
    .map(w => `  ${worktreeName(w.path)}: ${bytesLabel(w.bytes)}`)
    .join('\n')
  const tooltip = [
    usage.scannedAt
      ? `${usage.worktrees.length} worktrees take ${bytesLabel(usage.totalBytes)}${usage.isScanning ? ' (measuring again…)' : ''}`
      : 'Measuring the worktrees…',
    largest && `Largest:\n${largest}`,
    usage.disk &&
      [
        `Disk: ${bytesLabel(usage.disk.size)}`,
        `worktrees: ${percent(usage.totalBytes, usage.disk.size)}`,
        `everything else: ${percent(Math.max(0, usage.disk.used - usage.totalBytes), usage.disk.size)}`,
        `free: ${percent(usage.disk.free, usage.disk.size)} (${bytesLabel(usage.disk.free)})`,
      ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')

  return (
    <span className="win-disk" data-level={level} data-tooltip={tooltip} tabIndex={0}>
      <DiskPie usage={usage} />
      <span>{usage.scannedAt ? bytesLabel(usage.totalBytes) : 'Measuring…'}</span>
      <span className="visually-hidden"> in worktrees</span>
    </span>
  )
}

const PET_SPEED = 26
const PET_RUN_SPEED = 110
const PET_MARGIN = 20
const BALL_EVENT = 'claude-console:throw-ball'
const MAX_BALLS = 5

type PetAction = 'walk' | 'idle' | 'lie' | 'run' | 'play'

// A pet from vscode-pets walking the empty stretch of the window bar between
// the title and the status: it strolls to a random spot, then stands or lies
// down for a while, turning to face where it goes. A click on the empty bar
// drops a ball there, up to five at a time; each bounces to the floor, and the
// pet fetches them one by one, nearest first, playing with each before the next. Everything moves straight on the elements each frame, never through
// React, and nothing moves when motion is reduced.
const WalkingPet = ({
  pet,
  bar,
  title,
  status,
}: {
  pet: Pet
  bar: RefObject<HTMLDivElement>
  title: RefObject<HTMLHeadingElement>
  status: RefObject<HTMLDivElement>
}) => {
  const sprite = useRef<HTMLImageElement>(null)
  const ballNodes = useRef<Array<HTMLSpanElement | null>>([])
  const [action, setAction] = useState<PetAction>('idle')
  const pathOf = (which: PetAction) =>
    (which === 'lie' && pet.lie) ||
    (which === 'run' && (pet.run || pet.walk)) ||
    (which === 'play' && (pet.withBall || pet.idle)) ||
    (which === 'walk' ? pet.walk : pet.idle)

  useEffect(() => {
    for (const path of [pet.walk, pet.idle, pet.lie, pet.run, pet.withBall].filter(Boolean)) new Image().src = `/api/pet/${path}`
  }, [pet])

  useEffect(() => {
    const lane = { left: 0, right: 0, floor: 0 }
    const measure = () => {
      if (!bar.current || !title.current || !status.current) return

      const box = bar.current.getBoundingClientRect()
      const width = sprite.current?.getBoundingClientRect().width || pet.size

      lane.left = title.current.getBoundingClientRect().right - box.left + PET_MARGIN
      lane.right = status.current.getBoundingClientRect().left - box.left - PET_MARGIN - width
      lane.floor = box.height - BALL.size - 3
    }
    const observer = new ResizeObserver(measure)

    if (bar.current) observer.observe(bar.current)
    if (status.current) observer.observe(status.current)

    measure()

    const spriteWidth = () => sprite.current?.getBoundingClientRect().width || pet.size
    let x = lane.left + Math.max(0, lane.right - lane.left) * Math.random()
    let target = x
    let facing = 1
    let mode: PetAction = 'idle'
    let until = performance.now() + 1500
    let last = performance.now()
    let frame = 0
    // The balls in play, moved in place each frame.
    const balls: Ball[] = []
    let chasing: Ball | null = null

    const place = () => {
      const node = sprite.current

      if (node) {
        node.style.visibility = lane.right - lane.left < 40 ? 'hidden' : 'visible'
        node.style.transform = `translateX(${Math.round(x)}px) scaleX(${facing})`
      }

      ballNodes.current.forEach((dot, at) => {
        const ball = balls[at]

        if (!dot) return

        dot.style.display = ball ? 'block' : 'none'

        if (ball) dot.style.transform = `translate(${Math.round(ball.x - BALL.size / 2)}px, ${Math.round(ball.y)}px)`
      })
    }

    const become = (next: PetAction) => {
      mode = next
      setAction(next)
    }

    // Runs to the nearest ball left, if any.
    const chaseNext = () => {
      const width = spriteWidth()
      const center = x + width / 2
      const next = [...balls].sort((a, b) => Math.abs(a.x - center) - Math.abs(b.x - center))[0]

      if (!next) return false

      chasing = next
      target = next.x - width / 2
      facing = target >= x ? 1 : -1
      become('run')

      return true
    }

    const onThrow = (event: Event) => {
      if (balls.length >= MAX_BALLS) return

      const { x: at, y } = (event as CustomEvent<{ x: number; y: number }>).detail
      const width = spriteWidth()
      const ballX = Math.min(Math.max(at, lane.left + width / 2), lane.right + width / 2)

      balls.push(newBall(ballX, Math.min(Math.max(0, y - BALL.size / 2), lane.floor)))

      // Already fetching or playing, it gets to this one afterward.
      if (mode !== 'run' && mode !== 'play') chaseNext()

      place()
    }

    // Where the balls' centers may go: the empty stretch of the bar.
    const ballBounds = () => ({
      left: lane.left + BALL.size / 2,
      right: lane.right + spriteWidth() - BALL.size / 2,
      floor: lane.floor,
    })

    // The pointer moving over the bar hits the balls it passes, at its speed.
    let lastPointer: { x: number; y: number; at: number } | null = null

    const onPointerMove = (event: PointerEvent) => {
      const box = bar.current?.getBoundingClientRect()

      if (!box || balls.length === 0) return

      const point = { x: event.clientX - box.left, y: event.clientY - box.top, at: performance.now() }
      const elapsed = lastPointer ? Math.max(0.008, (point.at - lastPointer.at) / 1000) : 0
      const velocity = lastPointer && elapsed < 0.2
        ? { x: (point.x - lastPointer.x) / elapsed, y: (point.y - lastPointer.y) / elapsed }
        : { x: 0, y: 0 }

      lastPointer = point

      let wasHit = false

      for (const ball of balls) {
        const next = hitBall(ball, point, velocity, point.at)

        if (next !== ball) {
          Object.assign(ball, next)
          wasHit = true
        }
      }

      if (wasHit && (mode === 'walk' || mode === 'idle' || mode === 'lie')) chaseNext()
    }
    const onPointerLeave = () => {
      lastPointer = null
    }

    window.addEventListener(BALL_EVENT, onThrow)
    bar.current?.addEventListener('pointermove', onPointerMove)
    bar.current?.addEventListener('pointerleave', onPointerLeave)

    const barNode = bar.current

    if (prefersReducedMotion()) {
      place()

      return () => {
        observer.disconnect()
        window.removeEventListener(BALL_EVENT, onThrow)
        barNode?.removeEventListener('pointermove', onPointerMove)
        barNode?.removeEventListener('pointerleave', onPointerLeave)
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)

      last = now
      x = Math.min(Math.max(x, lane.left), Math.max(lane.left, lane.right))

      const bounds = ballBounds()

      for (const ball of balls) Object.assign(ball, stepBall(ball, bounds, dt))

      // A rolling ball moves the goal; the pet turns to follow it.
      if (mode === 'run' && chasing) {
        target = chasing.x - spriteWidth() / 2

        if (Math.abs(target - x) > 2) facing = target >= x ? 1 : -1
      }

      if (mode === 'walk' || mode === 'run') {
        const step = (mode === 'run' ? PET_RUN_SPEED : PET_SPEED) * dt
        const gap = target - x
        // It catches a ball only near the floor, not one flying overhead.
        const isCatchable = mode !== 'run' || !chasing || chasing.y >= lane.floor - 8

        if (Math.abs(gap) <= step + (mode === 'run' ? 2 : 0) && isCatchable) {
          x = target

          if (mode === 'run') {
            if (chasing) balls.splice(balls.indexOf(chasing), 1)

            chasing = null
            become('play')
            // A short play while more balls wait, a longer one after the last.
            until = now + (balls.length ? 900 : 2500 + Math.random() * 1500)
          } else {
            const lies = !!pet.lie && Math.random() < 0.3

            become(lies ? 'lie' : 'idle')
            until = now + (lies ? 5000 + Math.random() * 6000 : 1500 + Math.random() * 3500)
          }
        } else {
          // Under a ball still in the air, it waits instead of overshooting.
          x = Math.abs(gap) <= step ? target : x + Math.sign(gap) * step
        }
      } else if (now >= until && !chaseNext()) {
        target = lane.left + Math.max(0, lane.right - lane.left) * Math.random()
        facing = target >= x ? 1 : -1
        become('walk')
      }

      place()
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener(BALL_EVENT, onThrow)
      barNode?.removeEventListener('pointermove', onPointerMove)
      barNode?.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [pet, bar, title, status])

  return (
    <div className="pet-lane" aria-hidden="true">
      {Array.from({ length: MAX_BALLS }, (_, at) => (
        <span
          key={at}
          ref={node => {
            ballNodes.current[at] = node
          }}
          className="pet-ball"
        />
      ))}
      <img
        ref={sprite}
        className="pet"
        src={`/api/pet/${pathOf(action)}`}
        alt=""
        width={pet.size}
        style={{ width: pet.size }}
        data-tooltip={`${pet.credit}. Click the empty bar to throw it balls, up to five at a time.`}
        draggable={false}
      />
    </div>
  )
}

// A click on the bar itself, not on its title, status or buttons, throws the
// pet a ball where it landed.
const throwBall = (event: ReactMouseEvent<HTMLDivElement>) => {
  const barNode = event.currentTarget

  if (event.target !== barNode && !(event.target as Element).classList.contains('pet-lane')) return

  const box = barNode.getBoundingClientRect()

  window.dispatchEvent(new CustomEvent(BALL_EVENT, { detail: { x: event.clientX - box.left, y: event.clientY - box.top } }))
}

const closeWindow = async () => {
  window.close()

  // A page may not close a window it did not open; then the server closes the
  // console's app window through the window manager.
  await new Promise(resolve => setTimeout(resolve, 250))

  if (!window.closed) await windowAction('close')
}

const windowAction = async (action: 'close' | 'maximize') => {
  const response = await fetch(`/api/window/${action}`, { method: 'POST', headers: { 'X-Claude-Console': '1' } })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }

    throw new Error(body.error ?? `Could not ${action} the window.`)
  }
}

// Whether the window fills the screen, maximized by the window manager or in
// full screen, kept current as it is resized.
const useIsMaximized = () => {
  const measure = () =>
    !!document.fullscreenElement ||
    (window.outerWidth >= screen.availWidth - 2 && window.outerHeight >= screen.availHeight - 2)
  const [isMaximized, setIsMaximized] = useState(measure)

  useEffect(() => {
    const update = () => setIsMaximized(measure())

    window.addEventListener('resize', update)
    document.addEventListener('fullscreenchange', update)

    return () => {
      window.removeEventListener('resize', update)
      document.removeEventListener('fullscreenchange', update)
    }
  }, [])

  return isMaximized
}

// Toggles the app window between maximized and its previous size; in a browser
// tab, where the window manager cannot reach it, toggles full screen instead.
const toggleMaximized = async () => {
  if (document.fullscreenElement) return document.exitFullscreen()

  try {
    await windowAction('maximize')
  } catch {
    await document.documentElement.requestFullscreen()
  }
}

// A title bar in the manner of a desktop window: the console's name on the left,
// the battery, the time, and maximize and close buttons on the right.
const WindowBar = ({ title, hasIcon }: { title: string; hasIcon: boolean }) => {
  const { battery, disk, pet } = useSystem()
  const bar = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const now = useClock()
  const isMaximized = useIsMaximized()
  const [windowError, setWindowError] = useState('')
  const date = new Date(now)

  return (
    <div className="window-bar" ref={bar} onClick={pet ? throwBall : undefined} data-has-pet={pet ? true : undefined}>
      {pet && <WalkingPet pet={pet} bar={bar} title={titleRef} status={statusRef} />}
      <h1 className="win-title" ref={titleRef}>
        {hasIcon && <img className="brand-mark" src="/api/brand-icon" alt="" width={18} height={18} />}
        {title}
      </h1>
      <div className="win-status" ref={statusRef}>
        {windowError && (
          <span className="win-error" role="alert">
            {windowError}
          </span>
        )}
        {disk && (disk.scannedAt > 0 || disk.isScanning) && <WorktreeDisk usage={disk} />}
        {battery && <BatteryMeter battery={battery} />}
        <time className="win-clock" dateTime={date.toISOString()} data-tooltip={date.toLocaleString()}>
          <span className="win-date">{date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} </span>
          <strong>{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</strong>
        </time>
        <button
          type="button"
          className="win-button"
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          data-tooltip={isMaximized ? 'Restore window' : 'Maximize window'}
          onClick={() => {
            setWindowError('')
            toggleMaximized().catch((error: unknown) =>
              setWindowError(error instanceof Error ? error.message : String(error)),
            )
          }}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.5" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3.5 3.5V2.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="win-button win-close"
          aria-label="Close window"
          data-tooltip="Close window"
          onClick={() => {
            setWindowError('')
            closeWindow().catch((error: unknown) =>
              setWindowError(error instanceof Error ? error.message : String(error)),
            )
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

const ThemeSwitch = () => {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    const root = document.documentElement

    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme

    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, theme)
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }, [theme])

  const options: Array<{ id: Theme; label: string }> = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ]

  return (
    <div className="segmented" role="radiogroup" aria-label="Color theme">
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={theme === option.id}
          onClick={() => setTheme(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const useSnapshot = () => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  const firstBuild = useRef('')

  const load = useCallback(async (force = false) => {
    setIsRefreshing(force)
    setIsFetching(true)

    try {
      const response = await fetch(`/api/snapshot${force ? '?force' : ''}`)

      if (!response.ok) throw new Error(`The console server answered ${response.status}.`)

      const next = (await response.json()) as Snapshot

      // A new server means a new build: reload to run it instead of the old bundle.
      if (firstBuild.current && next.build && next.build !== firstBuild.current) {
        location.reload()
        return
      }

      firstBuild.current ||= next.build
      setSnapshot(next)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRefreshing(false)
      setIsFetching(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    const onRefresh = () => void load(true)

    window.addEventListener('claude-console:refresh', onRefresh)

    return () => {
      clearInterval(timer)
      window.removeEventListener('claude-console:refresh', onRefresh)
    }
  }, [load])

  return { snapshot, error, isRefreshing, isFetching, refresh: () => void load(true) }
}

const LIVE_POLL_MS = 2_000

// Which sessions run and whether each is working, polled fast and cheaply so
// the thinking indicator follows Claude Code within a couple of seconds.
const useLive = () => {
  const [live, setLive] = useState<LiveStatus | null>(null)
  const lastFocus = useRef(Date.now())

  useEffect(() => {
    let isActive = true

    const load = async () => {
      try {
        const response = await fetch('/api/live')

        if (!response.ok || !isActive) return

        const body = (await response.json()) as LiveResponse

        setLive(body.sessions)

        // A request from the status line's link to show a session: handle each
        // one once, and never one older than this page.
        if (body.focus && body.focus.at > lastFocus.current) {
          lastFocus.current = body.focus.at
          window.dispatchEvent(new CustomEvent('claude-console:focus-session', { detail: body.focus.session }))
        }
      } catch {
        // The full snapshot still carries each session's status.
      }
    }

    void load()
    const timer = setInterval(() => void load(), LIVE_POLL_MS)

    return () => {
      isActive = false
      clearInterval(timer)
    }
  }, [])

  return live
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const Thinking = ({ sessionId, since }: { sessionId: string; since: number }) => {
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(Date.now())
  const isStill = prefersReducedMotion()

  useEffect(() => {
    if (isStill) return

    const timer = setInterval(() => setTick(t => t + 1), 120)

    return () => clearInterval(timer)
  }, [isStill])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [])

  return (
    <span className="thinking" role="status" aria-label="Claude is working">
      <span className="thinking-glyph" aria-hidden>
        {isStill ? '✻' : spinnerFrame(tick)}
      </span>
      <span className="thinking-verb">{verbFor(sessionId, since)}…</span>
      {since > 0 && <span className="thinking-elapsed">{elapsedLabel(now - since)}</span>}
    </span>
  )
}

const useNow = () => {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000)

    return () => clearInterval(timer)
  }, [])

  return now
}

const ActivityStrip = ({ days }: { days: number[] }) => {
  const today = new Date()

  return (
    <span className="strip" role="img" aria-label={`${days.reduce((a, b) => a + b, 0)} HEAD moves in 14 days`}>
      {days.map((count, i) => {
        const date = new Date(today)
        date.setDate(today.getDate() - (days.length - 1 - i))
        const level = count === 0 ? 0 : count < 3 ? 1 : count < 8 ? 2 : 3

        return (
          <span
            key={i}
            className="strip-day"
            data-level={level}
            data-tooltip={`${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${count}`}
          />
        )
      })}
    </span>
  )
}

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)

    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.append(area)
    area.select()
    const isCopied = document.execCommand('copy')
    area.remove()

    return isCopied
  }
}

type MenuAction = {
  label: string
  run: () => Promise<string> | string
  disabled?: boolean
  hint?: string
  danger?: boolean
}

const openUrl = (url: string) =>
  fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify({ url }),
  }).then(response => response.ok)

const copyAction = (label: string, text: string): MenuAction => ({
  label,
  run: async () => ((await copy(text)) ? 'Copied' : 'Copy failed'),
})

const terminalAction = (label: string, dir: string, session?: string): MenuAction => ({
  label,
  run: async () => ((await openTab(dir, session).catch(() => false)) ? 'Opened in the terminal' : 'Could not open the terminal'),
})

// Starts a new Claude Code session in a new terminal tab: an empty one in a
// worktree, or the configured one in the repository.
const startSession = async (body: { dir?: string; input?: string; env?: string }): Promise<true | string> => {
  const response = await fetch('/api/session/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify(body),
  }).catch(() => null)

  if (response?.ok) return true

  const { error } = ((await response?.json().catch(() => ({}))) ?? {}) as { error?: string }

  return error ?? 'Could not start the session.'
}

const PlusIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
)

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

// A modal window over the page: it takes the focus and keeps Tab inside it,
// closes on Escape or a click outside, and gives the focus back on closing.
export const Modal = ({
  title,
  children,
  actions,
  onClose,
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose: () => void
}) => {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const titleId = useId()

  close.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]

    ;(panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close.current()
      } else if (event.key === 'Tab') {
        const list = focusables()
        const first = list[0]
        const last = list[list.length - 1]

        if (!first || !last) return

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    const overflow = document.body.style.overflow

    document.addEventListener('keydown', onKeyDown, true)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  // Rendered on the body, so a button inside a scrolling, masked or hovered
  // card can't trap the full-screen backdrop inside that card.
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) close.current()
      }}
    >
      <div ref={panel} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  )
}

type ConfirmRequest = {
  title: string
  body: ReactNode
  confirmLabel: string
  // null for a notice with a single button.
  cancelLabel?: string | null
  isDanger?: boolean
  resolve: (isConfirmed: boolean) => void
}

const CONFIRM_EVENT = 'claude-console:confirm'

// Asks in a modal, the way window.confirm does, and resolves with the answer.
export const askConfirm = (request: Omit<ConfirmRequest, 'resolve'>) =>
  new Promise<boolean>(resolve => window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: { ...request, resolve } })))

export const showNotice = async (title: string, body: ReactNode) => {
  await askConfirm({ title, body, confirmLabel: 'OK', cancelLabel: null })
}

// Shows the requests askConfirm makes, one at a time.
const ConfirmHost = () => {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    const onRequest = (event: Event) => setRequest((event as CustomEvent<ConfirmRequest>).detail)

    window.addEventListener(CONFIRM_EVENT, onRequest)

    return () => window.removeEventListener(CONFIRM_EVENT, onRequest)
  }, [])

  if (!request) return null

  const answer = (isConfirmed: boolean) => {
    request.resolve(isConfirmed)
    setRequest(null)
  }
  const cancelLabel = request.cancelLabel === undefined ? 'Cancel' : request.cancelLabel

  return (
    <Modal
      title={request.title}
      onClose={() => answer(false)}
      actions={
        <>
          {cancelLabel && (
            <button type="button" onClick={() => answer(false)} data-autofocus={request.isDanger || undefined}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className="primary"
            data-danger={request.isDanger || undefined}
            data-autofocus={!request.isDanger || undefined}
            onClick={() => answer(true)}
          >
            {request.confirmLabel}
          </button>
        </>
      }
    >
      {request.body}
    </Modal>
  )
}

const INPUT_PATTERN = /^[A-Za-z0-9._-]{1,80}$/
const PR_URL_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

// The "+" beside the session search. It opens a modal that says what will be
// created, asks for a ticket or a name when the configured first message needs
// one, and starts the Claude Code session in a new terminal tab on confirming.
const NewSessionButton = ({
  setup,
  repo,
  initialInput = '',
  label = 'Start a new Claude session',
  isSmall = false,
}: {
  setup: Snapshot['features']['newSession']
  repo: string
  // Fills the ticket or name in, such as a Jira ticket's key.
  initialInput?: string
  label?: string
  isSmall?: boolean
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState(initialInput)
  const [error, setError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [note, setNote] = useState('')
  const [env, setEnv] = useState('')
  const value = input.trim()
  const isValid = !setup.needsInput || INPUT_PATTERN.test(value) || PR_URL_PATTERN.test(value)
  const prompt = setup.prompt
    .replaceAll('{input}', value || `<${setup.inputLabel.toLowerCase()}>`)
    .replaceAll('{env}', env)
    .replace(/\s+/g, ' ')
    .trim()

  useEffect(() => {
    if (!note) return

    const timer = setTimeout(() => setNote(''), 4_000)

    return () => clearTimeout(timer)
  }, [note])

  const close = () => {
    setIsOpen(false)
    setInput(initialInput)
    setEnv('')
    setError('')
  }

  const start = async () => {
    if (!isValid || isStarting) return

    setIsStarting(true)

    const outcome = await startSession({ ...(setup.needsInput ? { input: value } : {}), ...(env ? { env } : {}) })

    setIsStarting(false)

    if (outcome === true) {
      close()
      setNote('Started in the terminal')
    } else {
      setError(outcome)
    }
  }

  return (
    <div className="new-session" data-small={isSmall || undefined}>
      {note && (
        <span className="menu-note" role="status">
          {note}
        </span>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        data-tooltip={label}
        aria-haspopup="dialog"
        onClick={() => {
          setInput(initialInput)
          setIsOpen(true)
        }}
      >
        <PlusIcon />
      </button>
      {isOpen && (
        <Modal
          title="New Claude session"
          onClose={close}
          actions={
            <>
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button type="submit" form="new-session-form" className="primary" disabled={!isValid || isStarting}>
                {isStarting ? 'Starting…' : 'Start session'}
              </button>
            </>
          }
        >
          <form
            id="new-session-form"
            className="modal-form"
            onSubmit={event => {
              event.preventDefault()
              void start()
            }}
          >
            <p className="modal-text">
              {setup.description || 'Starts a new Claude Code session in the repository.'} It opens in a new terminal tab.
            </p>
            {setup.needsInput && (
              <label className="modal-field">
                <span>{setup.inputLabel}</span>
                <input
                  data-autofocus
                  value={input}
                  onChange={event => {
                    setInput(event.target.value)
                    setError('')
                  }}
                  aria-invalid={value !== '' && !isValid}
                  aria-describedby="new-session-hint"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span id="new-session-hint" className="modal-hint">
                  A ticket or a name (letters, numbers, <code>.</code> <code>-</code> <code>_</code>), such as{' '}
                  <code>LPD-12345</code>, or a GitHub pull request link.
                </span>
              </label>
            )}
            {setup.environments.length > 0 && (
              <fieldset className="modal-field modal-choice">
                <legend>Frontend dev server</legend>
                <div className="segmented" role="radiogroup" aria-label="Frontend dev server">
                  {[{ label: 'None', value: '' }, ...setup.environments].map(option => (
                    <button
                      key={option.value || 'none'}
                      type="button"
                      role="radio"
                      aria-checked={env === option.value}
                      onClick={() => setEnv(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className="modal-hint">
                  {env
                    ? `Starts the dev server against ${setup.environments.find(e => e.value === env)?.label}.`
                    : 'No dev server: the session starts without one.'}
                </span>
              </fieldset>
            )}
            <dl className="modal-preview">
              <dt>Folder</dt>
              <dd>
                <code>{repo}</code>
              </dd>
              <dt>Runs</dt>
              <dd>
                <code>{prompt ? `claude "${prompt}"` : 'claude'}</code>
              </dd>
            </dl>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </div>
  )
}

const KebabIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
    <circle cx="8" cy="3" r="1.5" fill="currentColor" />
    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    <circle cx="8" cy="13" r="1.5" fill="currentColor" />
  </svg>
)

// The actions of one list item behind a vertical "..." button: a menu that opens
// below it, moves with the arrow keys, and closes on Escape, Tab or a click
// outside. The chosen action's outcome shows briefly beside the button.
const ActionMenu = ({ label, actions }: { label: string; actions: MenuAction[] }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [note, setNote] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]

  const close = (refocus: boolean) => {
    setIsOpen(false)

    if (refocus) trigger.current?.focus()
  }

  useEffect(() => {
    if (!isOpen) return

    items()[0]?.focus()

    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsOpen(false)
    }

    document.addEventListener('mousedown', onPointer)

    return () => document.removeEventListener('mousedown', onPointer)
  }, [isOpen])

  useEffect(() => {
    if (!note) return

    const timer = setTimeout(() => setNote(''), 2500)

    return () => clearTimeout(timer)
  }, [note])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const move = (index: number) => list[(index + list.length) % list.length]?.focus()

    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(at + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(at - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      move(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      move(list.length - 1)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className="menu" ref={root}>
      {note && (
        <span className="menu-note" role="status">
          {note}
        </span>
      )}
      <button
        ref={trigger}
        type="button"
        className="kebab"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={label}
        data-tooltip={label}
        onClick={() => setIsOpen(v => !v)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && !isOpen) {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
      >
        <KebabIcon />
      </button>
      {isOpen && (
        <ul className="menu-list" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {actions.map(action => (
            <li key={action.label} role="none">
              <button
                type="button"
                role="menuitem"
                data-danger={action.danger}
                disabled={action.disabled}
                onClick={async () => {
                  close(true)

                  const outcome = await action.run()

                  if (outcome) setNote(outcome)
                }}
              >
                <span>{action.label}</span>
                {action.hint && <span className="menu-hint">{action.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// The starred sessions' ids, newest first: set from each snapshot and right
// after a star is added or taken away, so the change shows at once.
let favoriteIds: string[] = []
let favoritesChangedAt = 0
const favoriteListeners = new Set<() => void>()

const setFavoriteIds = (ids: string[]) => {
  favoriteIds = ids
  favoriteListeners.forEach(listener => listener())
}

// A snapshot taken before the last local change would undo it, so it is ignored.
const syncFavorites = (ids: string[], generatedAt: number) => {
  if (generatedAt < favoritesChangedAt || ids.join() === favoriteIds.join()) return

  setFavoriteIds(ids)
}

const useFavorites = () =>
  useSyncExternalStore(
    listener => {
      favoriteListeners.add(listener)

      return () => favoriteListeners.delete(listener)
    },
    () => favoriteIds,
  )

const setFavorite = async (session: Session, isFavorite: boolean) => {
  const response = await fetch('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify({ session: session.id, isFavorite }),
  }).catch(() => null)
  const body = ((await response?.json().catch(() => null)) ?? {}) as { favorites?: string[]; error?: string }

  if (!response?.ok || !body.favorites) {
    await showNotice(
      isFavorite ? 'Not added to favorites' : 'Not removed from favorites',
      <p className="modal-text">{body.error ?? 'The console did not answer.'}</p>,
    )

    return false
  }

  favoritesChangedAt = Date.now()
  setFavoriteIds(body.favorites)

  return true
}

const confirmUnfavorite = async (session: Session) => {
  const isSure = await askConfirm({
    title: 'Remove from favorites?',
    body: (
      <p className="modal-text">
        <strong>{session.name || 'This session'}</strong> leaves your favorites. The session itself and its conversation
        stay as they are.
      </p>
    ),
    confirmLabel: 'Remove',
  })

  if (isSure) await setFavorite(session, false)
}

// The names given in the console, by session id: set from each snapshot and
// right after a rename, so the new name shows at once.
let sessionNames: Record<string, string> = {}
let namesChangedAt = 0
const nameListeners = new Set<() => void>()

const setSessionNames = (names: Record<string, string>) => {
  sessionNames = names
  nameListeners.forEach(listener => listener())
}

const syncNames = (names: Record<string, string>, generatedAt: number) => {
  if (generatedAt < namesChangedAt || JSON.stringify(names) === JSON.stringify(sessionNames)) return

  setSessionNames(names)
}

const useSessionNames = () =>
  useSyncExternalStore(
    listener => {
      nameListeners.add(listener)

      return () => nameListeners.delete(listener)
    },
    () => sessionNames,
  )

const saveSessionName = async (id: string, name: string) => {
  const previous = sessionNames
  const next = { ...sessionNames }

  if (name) next[id] = name
  else delete next[id]

  namesChangedAt = Date.now()
  setSessionNames(next)

  const response = await fetch('/api/session/name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify({ session: id, name }),
  }).catch(() => null)
  const body = ((await response?.json().catch(() => null)) ?? {}) as { names?: Record<string, string>; error?: string }

  if (response?.ok && body.names) {
    namesChangedAt = Date.now()
    setSessionNames(body.names)

    return
  }

  setSessionNames(previous)
  await showNotice('The session was not renamed', <p className="modal-text">{body.error ?? 'The console did not answer.'}</p>)
}

// A session's title that turns into a field on click. Enter or a click
// outside keeps the new name, Escape drops it, and an empty name (or Claude
// Code's own) goes back to the name Claude Code knows.
const SessionTitle = ({ session }: { session: Session }) => {
  const names = useSessionNames()
  const claudeName = session.claudeName ?? session.name
  const given = names[session.id]
  const shown = given ?? claudeName
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const isCancelled = useRef(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) return

    field.current?.focus()
    field.current?.select()
  }, [isEditing])

  const finish = () => {
    setIsEditing(false)

    if (isCancelled.current) return

    const next = draft.replace(/\s+/g, ' ').trim()

    if (next === shown) return

    void saveSessionName(session.id, next === claudeName ? '' : next)
  }

  if (isEditing) {
    return (
      <input
        ref={field}
        className="session-name-field"
        value={draft}
        maxLength={120}
        aria-label="Session name"
        placeholder={claudeName || 'Session name'}
        onChange={event => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            field.current?.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            isCancelled.current = true
            field.current?.blur()
          }
        }}
      />
    )
  }

  const isEmpty = !shown && session.responses === 0

  return (
    <button
      type="button"
      className="session-name"
      data-auto={!given && session.isAutoTitle}
      data-empty={isEmpty}
      data-given={!!given || undefined}
      data-tooltip={
        given
          ? `Named in the console${claudeName ? `; Claude Code calls it "${claudeName}"` : ''}. Click to rename.`
          : session.isAutoTitle
            ? 'Title Claude generated. Click to rename it here, or use /rename in the session.'
            : isEmpty
              ? 'Opened and closed without a conversation'
              : 'Click to rename'
      }
      onClick={() => {
        isCancelled.current = false
        setDraft(shown)
        setIsEditing(true)
      }}
    >
      {shown || (session.responses === 0 ? 'Empty session' : 'Untitled session')}
    </button>
  )
}

const StarIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path
      d="M8 1.4l1.95 4.1 4.45.55-3.27 3.08.84 4.42L8 11.4l-3.97 2.15.84-4.42L1.6 6.05l4.45-.55z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
  </svg>
)

const sessionActions = (session: Session, tree: Worktree | undefined): MenuAction[] => {
  const command = session.resumeDir ? resumeCommand(session) : ''
  const actions: MenuAction[] = [
    {
      ...terminalAction('Resume in terminal', session.resumeDir, session.id),
      disabled: !session.resumeDir || session.isRunning,
      hint: !session.resumeDir
        ? 'No transcript to resume'
        : session.isRunning
          ? 'Already running in a terminal'
          : undefined,
    },
    {
      ...copyAction('Copy resume command', command),
      disabled: !command,
      hint: command ? undefined : 'No transcript to resume',
    },
  ]

  if (session.top) actions.push(terminalAction('Open worktree in terminal', session.top))

  if (tree?.devServerPort) {
    actions.push({
      label: `Open dev server :${tree.devServerPort}`,
      run: async () => ((await openUrl(`http://localhost:${tree.devServerPort}`)) ? 'Opened' : 'Could not open'),
    })
  }

  actions.push(copyAction('Copy session id', session.id))

  if (session.remoteUrl) {
    actions.push({
      label: 'Open in Remote Control',
      run: async () => ((await openUrl(session.remoteUrl)) ? 'Opened' : 'Could not open'),
    })
  } else if (session.isRunning) {
    actions.push({
      label: 'Enable Remote Control…',
      run: async () => {
        const wantsCopy = await askConfirm({
          title: 'Turn on Remote Control',
          body: (
            <>
              <p className="modal-text">
                Remote Control lets you continue <strong>{session.name || 'this session'}</strong> on claude.ai or in the
                Claude app, while it keeps running here.
              </p>
              <p className="modal-text">
                A running session turns it on from inside: type <code>/remote-control</code> in its terminal. The console
                shows it as on as soon as it is.
              </p>
            </>
          ),
          confirmLabel: 'Copy /remote-control',
        })

        if (!wantsCopy) return ''

        return (await copy('/remote-control')) ? 'Copied' : 'Copy failed'
      },
    })
  } else if (session.resumeDir) {
    actions.push({
      label: 'Resume with Remote Control',
      run: async () =>
        (await openTab(session.resumeDir, session.id, true).catch(() => false)) ? 'Opened in the terminal' : 'Could not open the terminal',
    })
  }

  actions.push(
    favoriteIds.includes(session.id)
      ? { label: 'Remove from favorites', run: async () => ((await setFavorite(session, false)) ? 'Removed' : '') }
      : { label: 'Add to favorites', run: async () => ((await setFavorite(session, true)) ? 'Added to favorites' : '') },
  )

  if (session.isRunning) {
    actions.push({
      label: 'End Session',
      danger: true,
      run: async () => {
        const isSure = await askConfirm({
          title: 'End this session?',
          body: (
            <>
              <p className="modal-text">
                <strong>{session.name || session.id}</strong> stops, and its terminal tab closes. Any reply in progress is lost.
              </p>
              <p className="modal-text">
                The conversation is saved, so you can resume it later. The tab stays open if something else, such as a dev
                server, still runs in it.
              </p>
            </>
          ),
          confirmLabel: 'End Session',
          isDanger: true,
        })

        if (!isSure) return ''

        const response = await fetch('/api/session/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
          body: JSON.stringify({ session: session.id }),
        })
        const body = (await response.json().catch(() => ({}))) as { note?: string; error?: string }

        window.dispatchEvent(new Event('claude-console:refresh'))

        if (!response.ok) {
          await showNotice('The session was not ended', <p className="modal-text">{body.error ?? 'Unknown error'}</p>)

          return 'Not ended'
        }

        if (body.note && body.note.includes('kept its terminal')) {
          await showNotice('Session ended', <p className="modal-text">{body.note}</p>)
        }

        return 'Ended'
      },
    })
  }

  return actions
}

// Deletes a worktree, marking its row while git works. On success the row stays
// marked until the next snapshot drops it.
const removeWorktree = async (path: string, force: boolean) => {
  setDeleting(path, true)

  const response = await fetch('/api/worktree/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify({ path, force }),
  }).catch(() => null)

  if (response?.ok) {
    window.dispatchEvent(new Event('claude-console:refresh'))
    setTimeout(() => setDeleting(path, false), 30_000)

    return { ok: true, error: '', canForce: false }
  }

  setDeleting(path, false)

  const body = ((await response?.json().catch(() => null)) ?? {}) as { error?: string; canForce?: boolean }

  return { ok: false, error: body.error ?? 'The console did not answer.', canForce: !!body.canForce }
}

// The worktrees being deleted right now, shared by the menu action that starts
// a deletion and the rows that show it.
const deletingWorktrees = new Set<string>()
const deletingListeners = new Set<() => void>()

const setDeleting = (path: string, isDeleting: boolean) => {
  if (isDeleting) deletingWorktrees.add(path)
  else deletingWorktrees.delete(path)

  deletingListeners.forEach(listener => listener())
}

const useIsDeleting = (path: string) =>
  useSyncExternalStore(
    listener => {
      deletingListeners.add(listener)

      return () => deletingListeners.delete(listener)
    },
    () => deletingWorktrees.has(path),
  )

const worktreeActions = (worktree: Worktree): MenuAction[] => {
  const actions: MenuAction[] = [
    {
      label: 'Start session here',
      run: async () => ((await startSession({ dir: worktree.path })) === true ? 'Started in the terminal' : 'Could not start'),
    },
    terminalAction('Open in terminal', worktree.path),
  ]

  if (worktree.devServerPort) {
    actions.push({
      label: `Open dev server :${worktree.devServerPort}`,
      run: async () => ((await openUrl(`http://localhost:${worktree.devServerPort}`)) ? 'Opened' : 'Could not open'),
    })
  }

  actions.push(copyAction('Copy path', worktree.path))

  if (worktree.branch) actions.push(copyAction('Copy branch name', worktree.branch))

  if (worktree.activity === 'dormant' && !worktree.isMain) {
    actions.push({
      label: 'Delete worktree…',
      danger: true,
      disabled: !!worktree.devServerPort || worktree.sessions.some(s => s.isRunning),
      hint: worktree.devServerPort
        ? 'A dev server runs from it'
        : worktree.sessions.some(s => s.isRunning)
          ? 'A Claude session runs in it'
          : undefined,
      run: async () => {
        const isSure = await askConfirm({
          title: 'Delete this worktree?',
          body: (
            <>
              <p className="modal-text">
                This removes the folder of <strong>{worktree.name}</strong>.
                {worktree.branch && (
                  <>
                    {' '}
                    The branch <code>{worktree.branch}</code> and its commits stay.
                  </>
                )}
              </p>
              <p className="modal-text">
                Git refuses when the worktree holds uncommitted or untracked files, so no unsaved work is lost.
              </p>
              <dl className="modal-preview">
                <dt>Folder</dt>
                <dd>
                  <code>{worktree.path}</code>
                </dd>
              </dl>
            </>
          ),
          confirmLabel: 'Delete worktree',
          isDanger: true,
        })

        if (!isSure) return ''

        let outcome = await removeWorktree(worktree.path, false)

        if (!outcome.ok && outcome.canForce) {
          const isForced = await askConfirm({
            title: 'The worktree was not deleted',
            body: (
              <>
                <p className="modal-text">{outcome.error}</p>
                <p className="modal-text">
                  <strong>Force delete</strong> removes the folder anyway, and its uncommitted changes and untracked files
                  are lost for good.
                  {worktree.branch && (
                    <>
                      {' '}
                      The branch <code>{worktree.branch}</code> and its commits stay.
                    </>
                  )}
                </p>
              </>
            ),
            confirmLabel: 'Force delete',
            isDanger: true,
          })

          if (!isForced) return 'Not deleted'

          outcome = await removeWorktree(worktree.path, true)
        }

        if (outcome.ok) return 'Deleted'

        await showNotice('The worktree was not deleted', <p className="modal-text">{outcome.error}</p>)

        return 'Not deleted'
      },
    })
  }

  return actions
}

const WorktreeRow = ({ worktree, now }: { worktree: Worktree; now: number }) => {
  const live = worktree.sessions.filter(s => s.isLive)
  const isDeleting = useIsDeleting(worktree.path)

  return (
    <li className="wt" data-activity={worktree.activity} data-deleting={isDeleting || undefined} aria-busy={isDeleting || undefined}>
      <span className="wt-dot" aria-hidden />
      <span className="wt-main">
        <a
          className="wt-name"
          href={`ghosttycd://${worktree.path}`}
          data-tooltip={`Open ${worktree.path} in the terminal`}
          tabIndex={isDeleting ? -1 : undefined}
        >
          {worktree.name}
        </a>
        <code className="wt-branch">{worktree.isDetached ? `detached at ${worktree.sha}` : worktree.branch}</code>
        <span className="wt-subject">
          {worktree.repoName && <span className="wt-repo">{worktree.repoName}</span>}
          <TicketChip text={worktree.branch || worktree.name} />
          {worktree.subject}
        </span>
      </span>
      <ActivityStrip days={worktree.activityDays} />
      <span className="wt-touched" data-tooltip={new Date(worktree.lastTouchedAt).toLocaleString()}>
        {ago(worktree.lastTouchedAt, now)}
      </span>
      {isDeleting ? (
        <span className="wt-deleting" role="status">
          <span className="sync" data-busy="true" aria-hidden />
          Deleting…
        </span>
      ) : (
        <span className="wt-tags">
          {worktree.devServerPort && (
            <a className="tag tag-server" href={`http://localhost:${worktree.devServerPort}`}>
              :{worktree.devServerPort}
            </a>
          )}
          {worktree.devEnv && (
            <span className="tag tag-env" data-env={worktree.devEnv}>
              {worktree.devEnv}
            </span>
          )}
          {live.length > 0 && (
            <span className="tag tag-session" data-tooltip={live.map(s => `${s.name} · ctx ${s.ctx}%`).join('\n')}>
              {live.length === 1 ? 'Claude' : `Claude ×${live.length}`}
            </span>
          )}
        </span>
      )}
      {!isDeleting && (
        <span className="wt-menu">
          <ActionMenu label={`Actions for ${worktree.name}`} actions={worktreeActions(worktree)} />
        </span>
      )}
    </li>
  )
}

const FILTERS: Array<{ id: Activity; label: string; hint: string }> = [
  { id: 'active', label: 'Active', hint: 'touched in the last 3 days, or running a dev server or a Claude session' },
  { id: 'idle', label: 'Idle', hint: 'last touched 3 to 14 days ago' },
  { id: 'dormant', label: 'Dormant', hint: 'untouched for more than 14 days: prune candidates' },
]

const WORKTREE_PAGE = 5

const Worktrees = ({ worktrees, now }: { worktrees: Worktree[]; now: number }) => {
  const [filter, setFilter] = useState<Activity | 'all'>('active')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.id, worktrees.filter(w => w.activity === f.id).length])),
    [worktrees],
  )
  const shown = worktrees
    .filter(w => filter === 'all' || w.activity === filter)
    .filter(w => !query || `${w.name} ${w.repoName} ${w.branch} ${w.subject}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)
  // The five most recently touched, unless searching or asked for all.
  const visible = showAll || query ? shown : shown.slice(0, WORKTREE_PAGE)

  const choose = (next: Activity | 'all') => {
    setFilter(next)
    setShowAll(false)
  }

  return (
    <section className="panel worktrees" aria-labelledby="worktrees-title">
      <header className="panel-head">
        <h2 id="worktrees-title">Worktrees</h2>
        <div className="filters" role="tablist" aria-label="Filter worktrees">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              data-activity={f.id}
              data-tooltip={f.hint}
              onClick={() => choose(f.id)}
            >
              {f.label} <span className="count">{counts[f.id]}</span>
            </button>
          ))}
          <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => choose('all')}>
            All <span className="count">{worktrees.length}</span>
          </button>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Filter worktrees by name, branch or commit"
        />
      </header>
      {shown.length === 0 ? (
        <p className="empty">
          {query ? 'No worktree matches that filter.' : 'Nothing here. Switch the filter to see the rest.'}
        </p>
      ) : (
        <>
          <ul className="wt-list">
            {visible.map(w => (
              <WorktreeRow key={w.path} worktree={w} now={now} />
            ))}
          </ul>
          {!query && shown.length > WORKTREE_PAGE && (
            <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
              {showAll ? 'Show only the 5 most recent' : `Show ${shown.length - WORKTREE_PAGE} more`}
            </button>
          )}
        </>
      )}
      {filter === 'dormant' && shown.length > 0 && (
        <p className="note">
          Dormant worktrees are safe to review for pruning: run <code>/worktree-prune</code> in Claude Code.
        </p>
      )}
    </section>
  )
}

const CI_LABEL: Record<PullRequest['ci'], string> = {
  passing: 'CI passing',
  failing: 'CI failing',
  running: 'CI running',
  none: 'No checks',
}

const REVIEW_LABEL: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required',
}

const STALE_MS = 30 * 86_400_000

const SESSION_STATE_LABEL: Record<string, string> = { busy: 'working', waiting: 'waiting for you', idle: 'waiting for you' }

// Labels that lead to the Claude sessions behind a pull request or an
// artifact: the running ones, or else the most recent one, marked as ended.
const SessionLabels = ({ linked: unsorted }: { linked: Session[] }) => {
  const linked = [...unsorted].sort((a, b) => b.seenAt - a.seenAt)
  const running = linked.filter(session => session.isRunning)
  const shown = running.length > 0 ? running : linked.slice(0, 1)

  if (shown.length === 0) return null

  return (
    <span className="pr-sessions">
      {shown.map(session => (
        <button
          key={session.id}
          type="button"
          className="tag tag-session session-link"
          data-status={session.isRunning ? session.runStatus : 'ended'}
          data-tooltip={`Show the session ${session.name || session.id}`}
          onClick={() => window.dispatchEvent(new CustomEvent('claude-console:focus-session', { detail: session.id }))}
        >
          Claude: {session.name || 'Untitled session'}
          {session.isRunning
            ? SESSION_STATE_LABEL[session.runStatus] && <span className="session-link-state"> ({SESSION_STATE_LABEL[session.runStatus]})</span>
            : <span className="session-link-state"> (ended)</span>}
        </button>
      ))}
    </span>
  )
}

const PrSessions = ({ pr, sessions }: { pr: PullRequest; sessions: Session[] }) => (
  <SessionLabels linked={sessions.filter(session => prBelongsTo(pr, session))} />
)

// Whether a pull request belongs to the watched repository or one of its forks,
// judged by the repository's name: only then can a worktree check out its branch.
const isSameProject = (prRepo: string, repoPath: string) =>
  prRepo.split('/')[1]?.toLowerCase() === repoPath.split('/').filter(Boolean).pop()?.toLowerCase()

const PrRow = ({
  pr,
  now,
  sessions,
  setup,
  repo,
  showAuthor = false,
}: {
  pr: PullRequest
  now: number
  sessions: Session[]
  setup: Snapshot['features']['newSession']
  repo: string
  showAuthor?: boolean
}) => {
  const failing = pr.checks.filter(c => c.state === 'failure')

  return (
    <li className="pr" data-ci={pr.ci}>
      {setup.needsInput && !pr.worktreePath && isSameProject(pr.repo, repo) && (
        <NewSessionButton
          setup={setup}
          repo={repo}
          initialInput={pr.url}
          label={`Set up a worktree for ${pr.repo}#${pr.number}`}
          isSmall
        />
      )}
      {pr.ci !== 'none' && <span className="pr-ci">{CI_LABEL[pr.ci]}</span>}
      <a className="pr-title" href={pr.url}>
        {pr.title}
      </a>
      <span className="pr-meta">
        <span>
          {pr.repo}#{pr.number}
        </span>
        {showAuthor && pr.author && <span className="pr-author">by {pr.author}</span>}
        {pr.isDraft && <span className="tag">Draft</span>}
        {REVIEW_LABEL[pr.reviewDecision] && (
          <span className="tag" data-review={pr.reviewDecision}>
            {REVIEW_LABEL[pr.reviewDecision]}
          </span>
        )}
        <span className="diff">
          <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
        </span>
        <span>updated {ago(pr.updatedAt, now)}</span>
      </span>
      <code className="pr-branch">
        {pr.branch}
        {pr.worktreePath && (
          <a className="pr-wt" href={`ghosttycd://${pr.worktreePath}`} data-tooltip={pr.worktreePath}>
            has a worktree
          </a>
        )}
      </code>
      <PrSessions pr={pr} sessions={sessions} />
      {failing.length > 0 && (
        <span className="pr-failures">
          Failing:{' '}
          {failing.map((c, i) => (
            <span key={`${c.name}-${i}`}>
              {i > 0 && ', '}
              {c.url ? <a href={c.url}>{c.name}</a> : c.name}
            </span>
          ))}
        </span>
      )}
    </li>
  )
}

type PrTab = 'mine' | 'assigned'

const PullRequests = ({
  prs,
  assigned,
  now,
  sessions,
  setup,
  repo,
}: {
  prs: PullRequest[]
  assigned: PullRequest[]
  now: number
  sessions: Session[]
  setup: Snapshot['features']['newSession']
  repo: string
}) => {
  const [tab, setTab] = useState<PrTab>('mine')
  const [showStale, setShowStale] = useState(false)
  const list = tab === 'mine' ? prs : assigned
  const all = [...list].sort(
    (a, b) =>
      ['failing', 'running', 'passing', 'none'].indexOf(a.ci) - ['failing', 'running', 'passing', 'none'].indexOf(b.ci) ||
      b.updatedAt - a.updatedAt,
  )

  const ordered = all.filter(pr => now - pr.updatedAt < STALE_MS)
  const stale = all.filter(pr => now - pr.updatedAt >= STALE_MS)
  const row = (pr: PullRequest) => (
    <PrRow key={pr.url} pr={pr} now={now} sessions={sessions} setup={setup} repo={repo} showAuthor={tab === 'assigned'} />
  )

  return (
    <section className="panel prs" aria-labelledby="prs-title">
      <header className="panel-head">
        <h2 id="prs-title">Open pull requests</h2>
        <div className="filters" role="tablist" aria-label="Pull requests">
          {(['mine', 'assigned'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              data-tooltip={option === 'assigned' ? 'Assigned to you, or asking for your review' : 'Opened by you'}
              onClick={() => {
                setTab(option)
                setShowStale(false)
              }}
            >
              {option === 'mine' ? 'Mine' : 'Assigned to me'}
              <span className="count"> {(option === 'mine' ? prs : assigned).length}</span>
            </button>
          ))}
        </div>
      </header>
      {list.length === 0 ? (
        <p className="empty">
          {tab === 'mine' ? 'You have no open pull requests.' : 'No open pull request is assigned to you or asks for your review.'}
        </p>
      ) : ordered.length === 0 ? (
        <p className="empty">Nothing moved in the last 30 days.</p>
      ) : (
        <ul className="pr-list">{ordered.map(row)}</ul>
      )}
      {stale.length > 0 && (
        <>
          <button type="button" className="ghost more" onClick={() => setShowStale(v => !v)} aria-expanded={showStale}>
            {showStale
              ? 'Hide stale pull requests'
              : `Show ${stale.length} stale pull request${stale.length === 1 ? '' : 's'}, untouched for 30+ days`}
          </button>
          {showStale && <ul className="pr-list stale">{stale.map(row)}</ul>}
        </>
      )}
    </section>
  )
}

const RUN_STATUS: Record<string, string> = {
  busy: 'Working',
  waiting: 'Waiting for you',
  idle: 'Waiting for you',
  shell: 'In a shell command',
}

const RECENT_WHEN_NONE_LIVE = 5

const WorktreeTags = ({ worktree }: { worktree: Worktree | undefined }) => {
  if (!worktree || (!worktree.devServerPort && !worktree.devEnv)) return null

  return (
    <span className="wt-tags inline-tags">
      {worktree.devServerPort && (
        <a className="tag tag-server" href={`http://localhost:${worktree.devServerPort}`}>
          :{worktree.devServerPort}
        </a>
      )}
      {worktree.devEnv && (
        <span className="tag tag-env" data-env={worktree.devEnv}>
          {worktree.devEnv}
        </span>
      )}
    </span>
  )
}

const MONEY = ['💵', '💸', '💰', '🪙', '💲']
const PARTICLES = 15
const BURST_EVENT = 'claude-console:money-burst'

type Particle = { begin: number; dur: number; dx: number; dy: number; icon: string; rot: number; size: number }

const makeParticles = (): Particle[] =>
  Array.from({ length: PARTICLES }, (_, index) => {
    const angle = (Math.PI * 2 * index) / PARTICLES + Math.random() * 0.6
    const distance = 70 + Math.random() * 110

    return {
      begin: Math.random() * 0.06,
      dur: 0.85 + Math.random() * 0.4,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      icon: MONEY[Math.floor(Math.random() * MONEY.length)]!,
      rot: Math.random() * 120 - 60,
      size: 16 + Math.random() * 12,
    }
  })

// One explosion of money icons from (x, y), flying out in every direction and
// fading, the way ACBET bursts its cheers. SMIL drives each particle.
const MoneyBurst = ({ x, y }: { x: number; y: number }) => {
  const particles = useMemo(makeParticles, [])

  return (
    <svg className="burst">
      {particles.map((particle, index) => (
        <g key={index}>
          <animateTransform
            attributeName="transform"
            begin={`${particle.begin}s`}
            calcMode="spline"
            dur={`${particle.dur}s`}
            fill="freeze"
            from={`${x} ${y}`}
            keySplines="0.15 0.7 0.3 1"
            keyTimes="0;1"
            to={`${x + particle.dx} ${y + particle.dy}`}
            type="translate"
          />
          <text fontSize={particle.size} opacity="0" textAnchor="middle" dominantBaseline="central">
            {particle.icon}
            <animate
              attributeName="opacity"
              begin={`${particle.begin}s`}
              dur={`${particle.dur}s`}
              fill="freeze"
              keyTimes="0;0.18;0.6;1"
              values="0;1;1;0"
            />
            <animateTransform
              attributeName="transform"
              begin={`${particle.begin}s`}
              dur={`${particle.dur}s`}
              fill="freeze"
              from="0"
              to={`${particle.rot}`}
              type="rotate"
            />
          </text>
        </g>
      ))}
    </svg>
  )
}

// The page-wide layer the bursts draw on, so icons can fly past card edges.
const BurstLayer = () => {
  const [bursts, setBursts] = useState<Array<{ id: number; x: number; y: number }>>([])

  useEffect(() => {
    let next = 0

    const onBurst = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail
      const id = next++

      setBursts(list => [...list, { id, x, y }])
      setTimeout(() => setBursts(list => list.filter(b => b.id !== id)), 1600)
    }

    window.addEventListener(BURST_EVENT, onBurst)

    return () => window.removeEventListener(BURST_EVENT, onBurst)
  }, [])

  return (
    <div className="burst-layer" aria-hidden>
      {bursts.map(b => (
        <MoneyBurst key={b.id} x={b.x} y={b.y} />
      ))}
    </div>
  )
}

const CALM_AFTER_MOUNT_MS = 4000

// A session's cost so far. Each time it goes up, money bursts out of it; the
// first seconds after the page loads stay quiet so opening it never explodes.
const SessionCost = ({ cost }: { cost: number | null }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef<number | null>(null)
  const mountedAt = useRef(Date.now())
  const [pop, setPop] = useState(0)

  useEffect(() => {
    const before = previous.current
    previous.current = cost

    if (cost === null || before === null || cost <= before) return
    if (Date.now() - mountedAt.current < CALM_AFTER_MOUNT_MS || prefersReducedMotion()) return

    const rect = ref.current?.getBoundingClientRect()

    if (rect) {
      window.dispatchEvent(
        new CustomEvent(BURST_EVENT, { detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }),
      )
    }

    setPop(n => n + 1)
  }, [cost])

  if (cost === null) return null

  return (
    <span ref={ref} key={pop} className="session-cost" data-pop={pop > 0} data-tooltip="What this session has cost so far, at API prices">
      ${cost.toFixed(2)}
    </span>
  )
}

// The session's newest recap behind a small "?" beside its title: a popover
// that opens on click and closes on Escape, a click outside, or the icon again.
const RecapButton = ({ recap, recapAt, now }: { recap: string; recapAt: number; now: number }) => {
  const [isOpen, setIsOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!isOpen) return

    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  return (
    <span className="recap" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="recap-button"
        aria-expanded={isOpen}
        aria-controls={id}
        aria-label="Show the recap of this session"
        data-tooltip="Recap"
        onClick={() => setIsOpen(v => !v)}
      >
        ?
      </button>
      {isOpen && (
        <span className="recap-popover" id={id} role="dialog" aria-label="Session recap">
          <span className="recap-text">{recap}</span>
          {recapAt > 0 && (
            <span className="recap-age" data-tooltip={new Date(recapAt).toLocaleString()}>
              Recap from {ago(recapAt, now)}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

// The open pull requests a session's work belongs to: those Claude Code linked
// to it, those on its branch, and those
// naming the ticket in its branch or, on a detached worktree, in the worktree's
// folder name; plus the ones waiting in the review queue for the same ticket.
// The open pull requests a session's work belongs to (see prBelongsTo), plus
// the ones waiting in the review queue for the same ticket or link.
const SessionPrs = ({ session, prs, queue }: { session: Session; prs: PullRequest[]; queue: ReviewQueue | null }) => {
  const related = prs.filter(pr => prBelongsTo(pr, session))
  const waiting = (queue?.waiting ?? []).filter(pr =>
    prBelongsTo({ url: pr.url, branch: '', title: pr.title }, session),
  )

  if (related.length === 0 && waiting.length === 0) return null

  return (
    <span className="session-prs">
      {related.map(pr => (
        <a key={pr.url} className="tag" data-ci={pr.ci} href={pr.url} data-tooltip={`${pr.repo}#${pr.number}: ${pr.title} (${CI_LABEL[pr.ci]})`}>
          PR #{pr.number}
        </a>
      ))}
      {waiting.map(pr => (
        <a key={pr.url} className="tag" data-ci="passing" href={pr.url} data-tooltip={`Waiting in ${queue!.name}'s queue: ${pr.title}`}>
          {queue!.name} #{pr.number}
        </a>
      ))}
    </span>
  )
}

// The session's published Artifacts, behind a small orange square next to its
// title: hovering or focusing it lists them, and the list stays open while the
// pointer is over it, so its links can be clicked.
const SessionArtifacts = ({ session, artifacts }: { session: Session; artifacts: PublishedArtifact[] }) => {
  const mine = artifacts.filter(artifact => artifact.sessionIds.includes(session.id))
  const [isOpen, setIsOpen] = useState(false)
  const closing = useRef<ReturnType<typeof setTimeout>>()
  const id = useId()

  if (mine.length === 0) return null

  const open = () => {
    clearTimeout(closing.current)
    setIsOpen(true)
  }
  const close = () => {
    clearTimeout(closing.current)
    closing.current = setTimeout(() => setIsOpen(false), 180)
  }

  return (
    <span
      className="artifact-badge"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') setIsOpen(false)
      }}
    >
      <button
        type="button"
        className="artifact-badge-button"
        aria-label={`${plural(mine.length, 'artifact')} published from this session`}
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setIsOpen(v => !v)}
      >
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
          <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
        </svg>
      </button>
      {isOpen && (
        <span className="artifact-popover" id={id} role="dialog" aria-label="Artifacts of this session">
          <span className="artifact-popover-title">{plural(mine.length, 'artifact')}</span>
          {mine.map(artifact => (
            <a key={artifact.url} className="artifact-popover-link" href={artifact.url}>
              {artifact.title}
            </a>
          ))}
        </span>
      )}
    </span>
  )
}

const SessionRow = ({
  session: base,
  now,
  worktrees,
  live,
  prs,
  queue,
  artifacts,
}: {
  session: Session
  now: number
  worktrees: Worktree[]
  live: LiveStatus | null
  prs: PullRequest[]
  queue: ReviewQueue | null
  artifacts: PublishedArtifact[]
}) => {
  const current = live?.[base.id]
  const session: Session = live
    ? { ...base, isRunning: !!current, runStatus: current?.status ?? '', runSince: current?.since ?? 0, remoteUrl: current?.remoteUrl ?? '' }
    : base
  const agents = current?.agents ?? 0
  const cost = current?.cost ?? base.cost
  const worktree = worktreeOf(session)
  const tree = worktrees.find(w => w.path === session.top)
  const isFavorite = useFavorites().includes(session.id)

  return (
    <li className="session" id={`session-${session.id}`} data-live={session.isLive}>
      <span className="session-title">
        <SessionTitle session={session} />
        {session.recap && <RecapButton recap={session.recap} recapAt={session.recapAt} now={now} />}
        {session.remoteUrl && (
          <a
            className="remote-badge"
            href={session.remoteUrl}
            aria-label="Remote Control is on: open this session on claude.ai"
            data-tooltip="Remote Control is on: continue this session on claude.ai or in the Claude app"
          >
            rc
          </a>
        )}
        {isFavorite && (
          <button
            type="button"
            className="favorite-star"
            aria-label="Favorite; remove from favorites"
            data-tooltip="Favorite: click to remove"
            onClick={() => void confirmUnfavorite(session)}
          >
            <StarIcon />
          </button>
        )}
        <SessionArtifacts session={session} artifacts={artifacts} />
      </span>
      <span className="ctx" data-tooltip={`Context ${session.ctx}% used`}>
        <span className="ctx-bar">
          <span className="ctx-fill" style={{ width: `${Math.min(100, session.ctx)}%` }} data-level={levelOf(session.ctx)} />
        </span>
        {session.ctx}%
        <SessionCost cost={cost} />
        {session.model && <span className="tag model-tag">{session.model.toLowerCase()}</span>}
      </span>
      <span className="session-foot">
        {worktree.name && (
          <span className="session-worktree" data-tooltip={session.dir || session.top}>
            <span className="session-worktree-label">in</span>{' '}
            <a href={`ghosttycd://${session.top}`}>{worktree.name}</a>
            {worktree.inside && <span className="session-worktree-inside"> › {worktree.inside}</span>}
            <WorktreeTags worktree={tree} />
          </span>
        )}
        <TicketChip text={session.branch} />
        <SessionPrs session={session} prs={prs} queue={queue} />
        <span className="session-seen" data-status={session.isRunning ? session.runStatus : undefined}>
          {session.isRunning && session.runStatus === 'busy' ? (
            <Thinking sessionId={session.id} since={session.runSince} />
          ) : session.isRunning ? (
            RUN_STATUS[session.runStatus] ?? 'Running'
          ) : (
            ago(session.seenAt, now)
          )}
          {agents > 0 && (
            <span className="agents" data-tooltip={`${plural(agents, 'subagent')} of this session still working`}>
              {plural(agents, 'agent')}
            </span>
          )}
        </span>
      </span>
      <span className="session-menu">
        <ActionMenu label={`Actions for ${session.name || 'this session'}`} actions={sessionActions(session, tree)} />
      </span>
    </li>
  )
}

type SessionTab = 'all' | 'favorites'

const SESSION_TAB_KEY = 'claude-console:sessions-tab'

const readSessionTab = (): SessionTab => {
  try {
    return localStorage.getItem(SESSION_TAB_KEY) === 'favorites' ? 'favorites' : 'all'
  } catch {
    return 'all'
  }
}

const Sessions = ({
  sessions,
  now,
  worktrees,
  prs,
  queue,
  artifacts,
  newSession,
  repo,
  favoriteSessions,
}: {
  favoriteSessions: Session[]
  sessions: Session[]
  now: number
  worktrees: Worktree[]
  prs: PullRequest[]
  queue: ReviewQueue | null
  newSession: Snapshot['features']['newSession']
  repo: string
  artifacts: PublishedArtifact[]
}) => {
  const liveStatus = useLive()

  // A pull request's session label asks to show its session: reveal it among
  // the earlier ones when needed, scroll to it and flash it.
  useEffect(() => {
    const reveal = (id: string) => {
      const node = document.getElementById(`session-${id}`)

      if (!node) return false

      node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
      node.classList.remove('flash')
      void node.offsetWidth
      node.classList.add('flash')

      return true
    }

    const onFocus = (event: Event) => {
      const id = (event as CustomEvent<string>).detail

      if (reveal(id)) return

      // Hidden by the search, the Favorites tab or among the earlier sessions:
      // show them, then retry.
      setQuery('')
      setTab('all')
      setShowAll(true)
      requestAnimationFrame(() => requestAnimationFrame(() => reveal(id)))
    }

    window.addEventListener('claude-console:focus-session', onFocus)

    return () => window.removeEventListener('claude-console:focus-session', onFocus)
  }, [])
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<SessionTab>(readSessionTab)
  const favorites = useFavorites()
  const starred = favorites
    .map(id => sessions.find(s => s.id === id) ?? favoriteSessions.find(s => s.id === id))
    .filter((s): s is Session => !!s)
  const isSearching = query.trim() !== ''
  const matching = sessions.filter(s => sessionMatches(s, query))

  const chooseTab = (next: SessionTab) => {
    setTab(next)

    try {
      localStorage.setItem(SESSION_TAB_KEY, next)
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }

  const row = (s: Session) => (
    <SessionRow key={s.id} session={s} now={now} worktrees={worktrees} live={liveStatus} prs={prs} queue={queue} artifacts={artifacts} />
  )
  const live = matching.filter(s => s.isLive)
  const rest = matching.filter(s => !s.isLive)

  return (
    <section className="panel sessions" aria-labelledby="sessions-title">
      <header className="panel-head">
        <h2 id="sessions-title">Claude sessions</h2>
        <div className="filters" role="tablist" aria-label="Sessions">
          {(['all', 'favorites'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              aria-controls="sessions-tabpanel"
              onClick={() => chooseTab(option)}
            >
              {option === 'all' ? 'Recent' : 'Favorites'}
              {option === 'favorites' && <span className="count"> {starred.length}</span>}
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Filter Claude sessions by name, branch, worktree or model"
        />
        <NewSessionButton setup={newSession} repo={repo} />
      </header>
      <div id="sessions-tabpanel" role="tabpanel">
      {tab === 'favorites' ? (
        (() => {
          const shown = starred.filter(s => sessionMatches(s, query))

          return starred.length === 0 ? (
            <p className="empty">No favorite yet. Star a session with Add to favorites in its ⋮ menu.</p>
          ) : shown.length === 0 ? (
            <p className="empty">No favorite matches that filter.</p>
          ) : (
            <ul className="session-list">{shown.map(row)}</ul>
          )
        })()
      ) : isSearching ? (
        matching.length === 0 ? (
          <p className="empty">No session from the last day matches that filter.</p>
        ) : (
          <>
            <p className="match-count" role="status">
              {matching.length} of {sessions.length} sessions match
            </p>
            <ul className="session-list">
              {[...live, ...rest].map(s => (
                <SessionRow key={s.id} session={s} now={now} worktrees={worktrees} live={liveStatus} prs={prs} queue={queue} artifacts={artifacts} />
              ))}
            </ul>
          </>
        )
      ) : (
        <>
          {live.length === 0 ? (
            <>
              <p className="empty">
                No Claude session is running.{' '}
                {rest.length > 0 && `The ${Math.min(RECENT_WHEN_NONE_LIVE, rest.length)} most recent are below.`}
              </p>
              {rest.length > 0 && (
                <ul className="session-list">
                  {rest.slice(0, RECENT_WHEN_NONE_LIVE).map(s => (
                    <SessionRow key={s.id} session={s} now={now} worktrees={worktrees} live={liveStatus} prs={prs} queue={queue} artifacts={artifacts} />
                  ))}
                </ul>
              )}
            </>
          ) : (
            <ul className="session-list">
              {live.map(s => (
                <SessionRow key={s.id} session={s} now={now} worktrees={worktrees} live={liveStatus} prs={prs} queue={queue} artifacts={artifacts} />
              ))}
            </ul>
          )}
          {(() => {
            const hidden = live.length === 0 ? rest.slice(RECENT_WHEN_NONE_LIVE) : rest

            if (hidden.length === 0) return null

            return (
              <>
                <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
                  {showAll
                    ? 'Hide earlier sessions'
                    : `Show ${hidden.length} ${live.length === 0 ? 'more' : 'earlier'} sessions from the last day`}
                </button>
                {showAll && (
                  <ul className="session-list earlier">
                    {hidden.map(s => (
                      <SessionRow key={s.id} session={s} now={now} worktrees={worktrees} live={liveStatus} prs={prs} queue={queue} artifacts={artifacts} />
                    ))}
                  </ul>
                )}
              </>
            )
          })()}
        </>
      )}
      </div>
    </section>
  )
}

type JiraView = 'list' | 'board'

const JIRA_VIEW_KEY = 'claude-console:jira-view'

const readJiraView = (): JiraView => {
  try {
    return localStorage.getItem(JIRA_VIEW_KEY) === 'list' ? 'list' : 'board'
  } catch {
    return 'board'
  }
}

type Links = { trees: Worktree[]; pr?: PullRequest; sessions: Session[] }

// What already exists for a ticket: every worktree whose branch names it, the
// pull request about it, and the Claude sessions on those branches, running or
// recent. A ticket with a worktree gets these instead of a set-up button.
const linksOf = (issue: JiraIssue, worktrees: Worktree[], prs: PullRequest[], sessions: Session[]): Links => {
  const trees = worktrees.filter(w => w.branch && mentions(w.branch, issue.key))

  return {
    trees,
    pr: prs.find(p => mentions(p.branch, issue.key) || mentions(p.title, issue.key)),
    sessions: sessions.filter(x => mentions(x.branch, issue.key) || trees.some(w => w.path === x.top)),
  }
}

const IssueLinks = ({ links }: { links: Links }) => (
  <>
    {links.trees.map(tree => (
      <a key={tree.path} className="tag tag-worktree" href={`ghosttycd://${tree.path}`} data-tooltip={`Open ${tree.path} in the terminal`}>
        {tree.name}
      </a>
    ))}
    {links.pr && (
      <a className="tag" data-ci={links.pr.ci} href={links.pr.url}>
        PR #{links.pr.number}
        {links.pr.ci !== 'none' && `, ${CI_LABEL[links.pr.ci]}`}
      </a>
    )}
    <SessionLabels linked={links.sessions} />
  </>
)

const parentUrl = (issue: JiraIssue) => issue.url.replace(issue.key, issue.parentKey)

const JiraTickets = ({
  issues,
  worktrees,
  prs,
  sessions,
  now,
  newSession,
  startWork,
  repo,
}: {
  issues: JiraIssue[]
  worktrees: Worktree[]
  prs: PullRequest[]
  sessions: Session[]
  now: number
  newSession: Snapshot['features']['newSession']
  startWork: Snapshot['features']['startWork']
  repo: string
}) => {
  // A ticket without a worktree yet can get one: through Start Work when it is
  // configured, otherwise from the configured first message with the ticket's
  // key filled in.
  const setupFor = (issue: JiraIssue, links: Links) =>
    startWork && links.trees.length === 0 ? (
      <StartWorkButton issueKey={issue.key} repos={startWork.repos} isSmall />
    ) : newSession.needsInput && links.trees.length === 0 ? (
      <NewSessionButton
        setup={newSession}
        repo={repo}
        initialInput={issue.key}
        label={`Set up a worktree for ${issue.key}`}
        isSmall
      />
    ) : null

  const [view, setView] = useState<JiraView>(readJiraView)
  const boardRef = useScrollEdges<HTMLDivElement>()
  const statuses = orderStatuses(issues.map(i => ({ status: i.status, category: i.statusCategory })))
  const byStatus = new Map(
    statuses.map(status => [
      status,
      issues.filter(i => i.status === status).sort((a, b) => b.updatedAt - a.updatedAt),
    ]),
  )

  const choose = (next: JiraView) => {
    setView(next)

    try {
      localStorage.setItem(JIRA_VIEW_KEY, next)
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }

  return (
    <section className="panel jira" data-view={view} aria-labelledby="jira-title">
      <header className="panel-head">
        <h2 id="jira-title">Jira tickets</h2>
        <span className="jira-summary">{plural(issues.length, 'open ticket')}</span>
        <div className="segmented" role="radiogroup" aria-label="Jira view">
          {(['list', 'board'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={view === option}
              onClick={() => choose(option)}
            >
              {option === 'list' ? 'List' : 'Board'}
            </button>
          ))}
        </div>
      </header>
      {issues.length === 0 ? (
        <p className="empty">No open ticket is assigned to you.</p>
      ) : view === 'list' ? (
        statuses.map(status => {
          const list = byStatus.get(status)!

          return (
            <div key={status} className="jira-group" data-category={list[0]!.statusCategory}>
              <h3 className="jira-status">
                {status} <span className="count">{list.length}</span>
              </h3>
              <ul className="jira-list">
                {list.map(issue => {
                  const links = linksOf(issue, worktrees, prs, sessions)

                  return (
                  <li key={issue.key} className="jira-issue">
                    <a className="jira-key" href={issue.url}>
                      {issue.key}
                    </a>
                    <TicketLink ticketKey={issue.key} className="jira-summary-text">
                      {issue.summary}
                    </TicketLink>
                    <span className="jira-meta">
                      <span>{issue.type}</span>
                      {issue.parentKey && (
                        <a href={parentUrl(issue)} data-tooltip={issue.parentSummary}>
                          in {issue.parentKey}
                        </a>
                      )}
                      <span>updated {ago(issue.updatedAt, now)}</span>
                      <IssueLinks links={links} />
                    </span>
                    {setupFor(issue, links)}
                  </li>
                  )
                })}
              </ul>
            </div>
          )
        })
      ) : (
        <div ref={boardRef} className="board" role="list" aria-label="Jira board">
          {statuses.map(status => {
            const list = byStatus.get(status)!

            return (
              <section key={status} className="board-column" data-category={list[0]!.statusCategory} role="listitem">
                <h3 className="board-status">
                  {status} <span className="count">{list.length}</span>
                </h3>
                <ul className="board-cards">
                  {list.map(issue => {
                    const links = linksOf(issue, worktrees, prs, sessions)

                    return (
                    <li key={issue.key} className="card">
                      <span className="card-top">
                        <a className="jira-key" href={issue.url}>
                          {issue.key}
                        </a>
                        <span className="card-type" title={issue.type}>
                          {issue.type}
                        </span>
                      </span>
                      <TicketLink ticketKey={issue.key} className="card-summary" title={issue.summary}>
                        {issue.summary}
                      </TicketLink>
                      {issue.parentKey && (
                        <a className="card-parent" href={parentUrl(issue)} data-tooltip={issue.parentKey}>
                          {issue.parentSummary || issue.parentKey}
                        </a>
                      )}
                      <span className="card-links">
                        <IssueLinks links={links} />
                      </span>
                      <span className="card-foot">
                        <span className="card-updated">updated {ago(issue.updatedAt, now)}</span>
                        {setupFor(issue, links)}
                      </span>
                    </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}

const OUTCOME_LABEL: Record<QueuedPr['outcome'], string> = {
  waiting: 'Waiting',
  merged: 'Merged',
  rejected: 'Rejected',
  closed: 'Closed',
}

const QueuedRow = ({ pr, now, reviewer }: { pr: QueuedPr; now: number; reviewer: string }) => (
  <li className="queued" data-outcome={pr.outcome}>
    <span className="queued-top">
      <a className="jira-key" href={pr.url}>
        #{pr.number}
      </a>
      <span className="queued-when">
        {pr.outcome === 'waiting'
          ? `waiting ${ago(pr.createdAt, now).replace(' ago', '')}`
          : `${OUTCOME_LABEL[pr.outcome].toLowerCase()} ${ago(pr.closedAt ?? pr.createdAt, now)}`}
      </span>
    </span>
    <a className="queued-title" href={pr.url}>
      {pr.title}
    </a>
    {pr.reason && <span className="queued-reason">
        {reviewer}: {pr.reason}
      </span>}
    {pr.labels.length > 0 && (
      <span className="queued-labels">
        {pr.labels.map(label => (
          <span key={label.name} className="tag" data-check={label.state}>
            {label.name}
          </span>
        ))}
      </span>
    )}
  </li>
)

const QUEUE_RECENT = 5

const ReviewQueuePanel = ({
  queue,
  setup,
  now,
}: {
  queue: ReviewQueue | null
  setup: { name: string; repo: string }
  now: number
}) => {
  const [showAll, setShowAll] = useState(false)
  const recent = queue ? (showAll ? queue.recent : queue.recent.slice(0, QUEUE_RECENT)) : []

  return (
    <section className="panel review-queue" aria-labelledby="queue-title">
      <header className="panel-head">
        <h2 id="queue-title">In {setup.name}'s queue</h2>
        {queue && <span className="jira-summary">{plural(queue.waiting.length, 'waiting', 'waiting')}</span>}
      </header>
      {!queue ? (
        <p className="empty">Reading {setup.repo}…</p>
      ) : (
        <>
          {queue.waiting.length === 0 ? (
            <p className="empty">Nothing of yours is waiting for {setup.name}.</p>
          ) : (
            <ul className="queue-list">
              {queue.waiting.map(pr => (
                <QueuedRow key={pr.number} pr={pr} now={now} reviewer={setup.name} />
              ))}
            </ul>
          )}
          {queue.recent.length > 0 && (
            <>
              <h3 className="queue-subtitle">Recently through the queue</h3>
              <ul className="queue-list recent">
                {recent.map(pr => (
                  <QueuedRow key={pr.number} pr={pr} now={now} reviewer={setup.name} />
                ))}
              </ul>
              {queue.recent.length > QUEUE_RECENT && (
                <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
                  {showAll ? 'Show only the last 5' : `Show all ${queue.recent.length}`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

type HeatTab = 'combined' | 'github' | 'claude'

const HEAT_TAB_KEY = 'claude-console:activity-tab'
const CELL = 11
const GAP = 3
const LEFT = 28
const TOP = 16

const readHeatTab = (): HeatTab => {
  try {
    const stored = localStorage.getItem(HEAT_TAB_KEY)

    return stored === 'github' || stored === 'claude' ? stored : 'combined'
  } catch {
    return 'combined'
  }
}

const dayLong = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

const ContributionsCard = ({ contributions }: { contributions: Contributions | null }) => {
  const [tab, setTab] = useState<HeatTab>(readHeatTab)
  const [focus, setFocus] = useState<number | null>(null)

  const choose = (next: HeatTab) => {
    setTab(next)

    try {
      localStorage.setItem(HEAT_TAB_KEY, next)
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }

  if (!contributions) {
    return (
      <section className="panel heat" aria-labelledby="heat-title">
        <header className="panel-head">
          <h2 id="heat-title">Activity</h2>
        </header>
        <p className="empty">Reading GitHub contributions and Claude's history…</p>
      </section>
    )
  }

  const days = contributions.days
  const github = days.map(d => d.github)
  const claude = days.map(d => d.claude)
  const values = tab === 'github' ? github : tab === 'claude' ? claude : blend(github, claude)
  const scale = quartileScale(values)
  const firstWeekday = new Date(`${days[0]!.date}T12:00:00`).getDay()
  const weeks = Math.ceil((days.length + firstWeekday) / 7)
  const width = LEFT + weeks * (CELL + GAP)
  const height = TOP + 7 * (CELL + GAP)
  const months = days
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.date.endsWith('-01') || false)
    .map(({ d, i }) => ({
      label: new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }),
      x: LEFT + Math.floor((i + firstWeekday) / 7) * (CELL + GAP),
    }))
  const totals = { github: github.reduce((a, b) => a + b, 0), claude: claude.reduce((a, b) => a + b, 0) }
  const busiest = days.reduce((best, d, i) => (values[i]! > values[best]! ? i : best), 0)
  const shown = focus === null ? null : days[focus]!
  const describe = (d: (typeof days)[number]) =>
    tab === 'github'
      ? `${dayLong(d.date)}: ${plural(d.github, 'GitHub contribution')}`
      : tab === 'claude'
        ? `${dayLong(d.date)}: ${plural(d.claude, 'Claude tool call')}`
        : `${dayLong(d.date)}: ${plural(d.github, 'GitHub contribution')}, ${plural(d.claude, 'Claude tool call')}`

  return (
    <section className="panel heat" data-tab={tab} aria-labelledby="heat-title">
      <header className="panel-head">
        <h2 id="heat-title">Activity</h2>
        <div className="segmented" role="radiogroup" aria-label="Activity source">
          {(['combined', 'github', 'claude'] as const).map(option => (
            <button key={option} type="button" role="radio" aria-checked={tab === option} onClick={() => choose(option)}>
              {option === 'combined' ? 'Combined' : option === 'github' ? 'GitHub' : 'Claude'}
            </button>
          ))}
        </div>
      </header>
      <p className="heat-summary">
        {tab === 'github'
          ? `${totals.github.toLocaleString()} GitHub contributions`
          : tab === 'claude'
            ? `${totals.claude.toLocaleString()} Claude tool calls`
            : `${totals.github.toLocaleString()} GitHub contributions and ${totals.claude.toLocaleString()} Claude tool calls`}{' '}
        in the last {Math.round(days.length / 7)} weeks
      </p>
      <svg
        className="heatmap"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Activity per day; busiest day ${describe(days[busiest]!)}`}
        onMouseLeave={() => setFocus(null)}
      >
        {months.map(m => (
          <text key={`${m.label}-${m.x}`} className="heat-label" x={m.x} y={10}>
            {m.label}
          </text>
        ))}
        {[1, 3, 5].map(row => (
          <text key={row} className="heat-label" x={0} y={TOP + row * (CELL + GAP) + CELL - 2}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][row]}
          </text>
        ))}
        {days.map((d, i) => {
          const slot = i + firstWeekday

          return (
            <rect
              key={d.date}
              className="heat-cell"
              data-level={scale(values[i]!)}
              data-focus={focus === i}
              x={LEFT + Math.floor(slot / 7) * (CELL + GAP)}
              y={TOP + (slot % 7) * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              tabIndex={0}
              aria-label={describe(d)}
              onMouseEnter={() => setFocus(i)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
            >
              <title>{describe(d)}</title>
            </rect>
          )
        })}
      </svg>
      <div className="heat-foot">
        <span className="heat-detail" role="status">
          {shown ? describe(shown) : `Busiest: ${describe(days[busiest]!)}`}
        </span>
        <span className="heat-legend" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map(level => (
            <span key={level} className="heat-swatch" data-level={level} />
          ))}
          More
        </span>
      </div>
    </section>
  )
}

const MEMORY_TYPES = ['project', 'reference', 'feedback', 'user'] as const
const MEMORY_PAGE = 5
const FRESH_MS = 86_400_000

// The small markdown a memory note uses: **bold**, `code` and [[links]] to
// other notes, rendered as elements, never as HTML.
type LinkResolver = { open: (name: string) => void; exists: (name: string) => boolean }

const Inline = ({ text, links }: { text: string; links: LinkResolver }) => (
  <>
    {text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>
          <Inline text={part.slice(2, -2)} links={links} />
        </strong>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : part.startsWith('[[') && part.endsWith(']]') ? (
        links.exists(part.slice(2, -2)) ? (
          <button key={i} type="button" className="memory-link" onClick={() => links.open(part.slice(2, -2))}>
            {part.slice(2, -2)}
          </button>
        ) : (
          <span key={i} className="memory-link" data-missing data-tooltip="No note with this name yet">
            {part.slice(2, -2)}
          </span>
        )
      ) : (
        part
      ),
    )}
  </>
)

const MemoryBody = ({
  body,
  links,
  backlinks,
}: {
  body: string
  links: LinkResolver
  backlinks: MemoryNote[]
}) => (
  <div className="memory-body">
    {body.split(/\n{2,}/).map((block, i) => {
      const lines = block.split('\n')

      return lines.every(line => /^\s*[-*]\s/.test(line)) ? (
        <ul key={i}>
          {lines.map((line, j) => (
            <li key={j}>
              <Inline text={line.replace(/^\s*[-*]\s/, '')} links={links} />
            </li>
          ))}
        </ul>
      ) : (
        <p key={i}>
          {lines.map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              <Inline text={line} links={links} />
            </span>
          ))}
        </p>
      )
    })}
    {backlinks.length > 0 && (
      <p className="memory-backlinks">
        Linked from{' '}
        {backlinks.map((note, i) => (
          <span key={note.file}>
            {i > 0 && ', '}
            <button type="button" className="memory-link" onClick={() => links.open(note.name)}>
              {note.title}
            </button>
          </span>
        ))}
      </p>
    )}
  </div>
)

// Claude's memory of this project as an index, the way Claude reads it: a title
// and one-line hook per note, newest first, filtered by type or text; a note
// opens in place, and its [[links]] open the notes they name.
const MEMORY_VIEW_KEY = 'claude-console:memory-view'

const readMemoryView = (): 'list' | 'graph' => {
  try {
    return localStorage.getItem(MEMORY_VIEW_KEY) === 'graph' ? 'graph' : 'list'
  } catch {
    return 'list'
  }
}

const PAGE = 5

// The first five of a list, with a button that shows the rest; it folds back
// whenever resetKey changes, such as on a new tab.
const usePaged = <T,>(items: T[], resetKey: unknown = null) => {
  const [showAll, setShowAll] = useState(false)

  useEffect(() => setShowAll(false), [resetKey])

  const visible = showAll ? items : items.slice(0, PAGE)
  const toggle =
    items.length > PAGE ? (
      <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
        {showAll ? 'Show fewer' : `Show ${items.length - PAGE} more`}
      </button>
    ) : null

  return { visible, toggle }
}

const MCP_LABEL: Record<McpServer['status'], string> = { connected: 'Connected', auth: 'Needs authentication', failed: 'Failed' }
const MCP_ORDER: Record<McpServer['status'], number> = { failed: 0, auth: 1, connected: 2 }

// The MCP servers Claude Code would load from the watched repository, with the
// health `claude mcp list` reports: failures first, then the ones waiting for a
// sign-in, then the connected ones.
const McpCard = ({ mcp, now }: { mcp: ClaudeKnowledge['mcp']; now: number }) => {
  const [filter, setFilter] = useState<McpServer['status'] | 'all'>('all')
  const [isChecking, setIsChecking] = useState(false)
  const counts = { connected: 0, auth: 0, failed: 0 }

  for (const server of mcp.servers) counts[server.status] += 1

  const shown = mcp.servers
    .filter(s => filter === 'all' || s.status === filter)
    .sort((a, b) => MCP_ORDER[a.status] - MCP_ORDER[b.status] || a.name.localeCompare(b.name))
  const paged = usePaged(shown, filter)

  const check = async () => {
    setIsChecking(true)
    await fetch('/api/knowledge/refresh', { method: 'POST', headers: { 'X-Claude-Console': '1' } }).catch(() => null)
    window.dispatchEvent(new Event('claude-console:refresh'))
    setIsChecking(false)
  }

  return (
    <section className="panel mcp" aria-labelledby="mcp-title">
      <header className="panel-head">
        <h2 id="mcp-title">MCP servers</h2>
        <div className="filters" role="tablist" aria-label="MCP servers by state">
          {(['all', 'failed', 'auth', 'connected'] as const).map(option => (
            <button key={option} type="button" role="tab" aria-selected={filter === option} onClick={() => setFilter(option)}>
              {option === 'all' ? 'All' : MCP_LABEL[option]}
              <span className="count"> {option === 'all' ? mcp.servers.length : counts[option]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="ghost mcp-check" onClick={() => void check()} disabled={isChecking}>
          {isChecking ? 'Checking…' : 'Check again'}
        </button>
      </header>
      {mcp.error ? (
        <p className="empty">{mcp.error}</p>
      ) : mcp.checkedAt === 0 ? (
        <p className="empty">Checking the MCP servers…</p>
      ) : shown.length === 0 ? (
        <p className="empty">No server in this state.</p>
      ) : (
        <ul className="mcp-list">
          {paged.visible.map(server => (
            <li key={server.name} className="mcp-server" data-status={server.status}>
              <span className="mcp-dot" aria-hidden />
              <span className="mcp-name">{server.name}</span>
              <span className="mcp-state">{MCP_LABEL[server.status]}</span>
              <code className="mcp-target" data-tooltip={server.target}>
                {server.target}
              </code>
              {server.detail && <span className="mcp-detail">{server.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && paged.toggle}
      {mcp.checkedAt > 0 && <p className="panel-foot">Checked {ago(mcp.checkedAt, now)}</p>}
    </section>
  )
}

const InstructionItem = ({ item, now }: { item: Instruction; now: number }) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <li className="instruction" data-open={isOpen}>
      <button type="button" className="instruction-head" aria-expanded={isOpen} onClick={() => setIsOpen(v => !v)}>
        <span className="instruction-title">{item.title}</span>
        <span className="tag">{item.scope === 'user' ? 'yours' : 'project'}</span>
        <code className="instruction-path">{item.path}</code>
        <span className="instruction-age" data-tooltip={new Date(item.updatedAt).toLocaleString()}>
          {ago(item.updatedAt, now)}
        </span>
      </button>
      {!isOpen && item.summary && <p className="instruction-summary">{item.summary}</p>}
      {isOpen && <pre className="instruction-body">{item.body}</pre>}
    </li>
  )
}

// The CLAUDE.md files and rules Claude Code follows here. Clicking one shows it.
const InstructionsCard = ({ items, now }: { items: Instruction[]; now: number }) => {
  const paged = usePaged(items)

  return (
  <section className="panel instructions" aria-labelledby="instructions-title">
    <header className="panel-head">
      <h2 id="instructions-title">Instructions</h2>
      <span className="jira-summary">{plural(items.length, 'file')}</span>
    </header>
    {items.length === 0 ? (
      <p className="empty">
        No <code>CLAUDE.md</code> or rule file, yours or the repository's.
      </p>
    ) : (
      <>
        <ul className="instruction-list">
          {paged.visible.map(item => (
            <InstructionItem key={item.path} item={item} now={now} />
          ))}
        </ul>
        {paged.toggle}
      </>
    )}
  </section>
  )
}

const HOOK_SCOPE: Record<string, string> = { user: 'yours', project: 'project', local: 'local' }

// The hooks Claude Code runs, from your settings and the repository's.
const HooksCard = ({ hooks }: { hooks: ClaudeKnowledge['hooks'] }) => {
  const paged = usePaged(hooks)

  return (
  <section className="panel hooks" aria-labelledby="hooks-title">
    <header className="panel-head">
      <h2 id="hooks-title">Hooks</h2>
      <span className="jira-summary">{plural(hooks.length, 'hook')}</span>
    </header>
    {hooks.length === 0 ? (
      <p className="empty">No hook in your settings or the repository's.</p>
    ) : (
      <>
      <ul className="hook-list">
        {paged.visible.map((hook, at) => (
          <li key={at} className="hook">
            <span className="hook-when">
              <strong>{hook.event}</strong>
              {hook.matcher && <code>{hook.matcher}</code>}
              <span className="tag">{HOOK_SCOPE[hook.scope]}</span>
            </span>
            <code className="hook-command" data-tooltip={hook.command}>
              {hook.command}
            </code>
          </li>
        ))}
      </ul>
      {paged.toggle}
      </>
    )}
  </section>
  )
}

type ExtensionTab = 'plugins' | 'commands' | 'agents'

const EXTENSION_TABS: Array<{ id: ExtensionTab; label: string; kinds: Extension['kind'][] }> = [
  { id: 'plugins', label: 'Plugins', kinds: ['plugin', 'local plugin'] },
  { id: 'commands', label: 'Commands', kinds: ['command'] },
  { id: 'agents', label: 'Agents', kinds: ['agent'] },
]

// Plugins (from marketplaces and local folders), slash commands and subagents.
const ExtensionsCard = ({ extensions }: { extensions: Extension[] }) => {
  const [tab, setTab] = useState<ExtensionTab>('plugins')
  const of = (id: ExtensionTab) => extensions.filter(e => EXTENSION_TABS.find(t => t.id === id)!.kinds.includes(e.kind))
  const shown = of(tab).sort((a, b) => Number(b.isEnabled) - Number(a.isEnabled) || a.name.localeCompare(b.name))
  const paged = usePaged(shown, tab)

  return (
    <section className="panel extensions" aria-labelledby="extensions-title">
      <header className="panel-head">
        <h2 id="extensions-title">Extensions</h2>
        <div className="filters" role="tablist" aria-label="Extensions">
          {EXTENSION_TABS.map(option => (
            <button key={option.id} type="button" role="tab" aria-selected={tab === option.id} onClick={() => setTab(option.id)}>
              {option.label}
              <span className="count"> {of(option.id).length}</span>
            </button>
          ))}
        </div>
      </header>
      {shown.length === 0 ? (
        <p className="empty">None here, yours or the repository's.</p>
      ) : (
        <ul className="extension-list">
          {paged.visible.map(item => (
            <li key={`${item.kind}-${item.scope}-${item.name}`} className="extension" data-enabled={item.isEnabled}>
              <span className="extension-head">
                <span className="extension-name">{item.kind === 'command' ? `/${item.name}` : item.name}</span>
                {item.kind === 'local plugin' && <span className="tag">local</span>}
                <span className="tag">{item.scope === 'user' ? 'yours' : 'project'}</span>
                {!item.isEnabled && <span className="tag">disabled</span>}
              </span>
              {item.description && <span className="extension-description">{item.description}</span>}
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && paged.toggle}
    </section>
  )
}

type SkillTab = 'personal' | 'project'

const SKILL_TAB_KEY = 'claude-console:skills-tab'
const SKILL_PAGE = 5

const readSkillTab = (): SkillTab => {
  try {
    return localStorage.getItem(SKILL_TAB_KEY) === 'project' ? 'project' : 'personal'
  } catch {
    return 'personal'
  }
}

const SkillItem = ({ skill, now }: { skill: Skill; now: number }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [note, setNote] = useState('')
  const command = `/${skill.name}`

  useEffect(() => {
    if (!note) return

    const timer = setTimeout(() => setNote(''), 2_000)

    return () => clearTimeout(timer)
  }, [note])

  return (
    <li className="skill" data-open={isOpen}>
      <span className="skill-head">
        <button
          type="button"
          className="skill-name"
          data-tooltip={`Copy ${command}`}
          onClick={async () => setNote((await copy(command)) ? 'Copied' : 'Copy failed')}
        >
          {command}
        </button>
        {skill.argumentHint && <code className="skill-args">{skill.argumentHint}</code>}
        <span className="skill-uses" data-unused={skill.uses === 0 || undefined}>
          {skill.uses === 0 ? 'not used lately' : `used ${skill.uses}×, last ${ago(skill.lastUsedAt, now)}`}
        </span>
        {note && (
          <span className="skill-note" role="status">
            {note}
          </span>
        )}
      </span>
      {skill.description && (
        <button
          type="button"
          className="skill-description"
          aria-expanded={isOpen}
          data-tooltip={isOpen ? 'Show less' : 'Show the whole description'}
          onClick={() => setIsOpen(v => !v)}
        >
          {skill.description}
        </button>
      )}
    </li>
  )
}

// Your skills, and the ones the watched repository ships: each one's command,
// arguments and description. Clicking a command copies it.
const SkillsCard = ({ skills, now }: { skills: Skill[]; now: number }) => {
  const [tab, setTab] = useState<SkillTab>(readSkillTab)
  const [sort, setSort] = useState<'name' | 'uses'>('name')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const counts = { personal: skills.filter(s => s.source === 'personal').length, project: skills.filter(s => s.source === 'project').length }
  const q = query.trim().toLowerCase()
  const matching = skills
    .filter(s => s.source === tab)
    .filter(s => !q || `${s.name} ${s.description} ${s.argumentHint}`.toLowerCase().includes(q))
    .sort((a, b) => (sort === 'uses' ? b.uses - a.uses || b.lastUsedAt - a.lastUsedAt : 0) || a.name.localeCompare(b.name))
  const shown = showAll || q ? matching : matching.slice(0, SKILL_PAGE)

  const choose = (next: SkillTab) => {
    setTab(next)
    setShowAll(false)

    try {
      localStorage.setItem(SKILL_TAB_KEY, next)
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }

  return (
    <section className="panel skills" aria-labelledby="skills-title">
      <header className="panel-head">
        <h2 id="skills-title">Skills</h2>
        <div className="filters" role="tablist" aria-label="Skills">
          {(['personal', 'project'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              aria-controls="skills-tabpanel"
              onClick={() => choose(option)}
            >
              {option === 'personal' ? 'Mine' : 'Project'}
              <span className="count"> {counts[option]}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Filter skills by name or description"
        />
        <div className="segmented" role="radiogroup" aria-label="Sort skills">
          {(['name', 'uses'] as const).map(option => (
            <button key={option} type="button" role="radio" aria-checked={sort === option} onClick={() => setSort(option)}>
              {option === 'name' ? 'A–Z' : 'Most used'}
            </button>
          ))}
        </div>
      </header>
      <div id="skills-tabpanel" role="tabpanel">
        {counts[tab] === 0 ? (
          <p className="empty">
            {tab === 'personal' ? (
              <>
                No skill in <code>~/.claude/skills</code> yet.
              </>
            ) : (
              <>
                The repository has no skill in <code>.claude/skills</code>.
              </>
            )}
          </p>
        ) : matching.length === 0 ? (
          <p className="empty">No skill matches that filter.</p>
        ) : (
          <>
            <ul className="skill-list">
              {shown.map(skill => (
                <SkillItem key={skill.path} skill={skill} now={now} />
              ))}
            </ul>
            {!q && matching.length > SKILL_PAGE && (
              <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
                {showAll ? 'Show fewer' : `Show all ${matching.length} skills`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}

const MemoryCard = ({ notes, now }: { notes: MemoryNote[]; now: number }) => {
  const [view, setView] = useState<'list' | 'graph'>(readMemoryView)
  const [type, setType] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const counts = Object.fromEntries(MEMORY_TYPES.map(t => [t, notes.filter(n => n.type === t).length]))
  const q = query.trim().toLowerCase()
  const matching = notes
    .filter(n => type === 'all' || n.type === type)
    .filter(n => !q || `${n.title} ${n.hook} ${n.description} ${n.body}`.toLowerCase().includes(q))
  const shown = showAll || q ? matching : matching.slice(0, MEMORY_PAGE)

  const byKey = useMemo(() => {
    const map = new Map<string, MemoryNote>()

    for (const note of notes) {
      map.set(memoryKey(note.file), note)
      map.set(memoryKey(note.name), note)
    }

    return map
  }, [notes])
  const backlinks = useMemo(() => {
    const map = new Map<string, MemoryNote[]>()

    for (const note of notes) {
      for (const target of new Set(memoryLinks(note.body).map(name => byKey.get(memoryKey(name))))) {
        if (target && target.file !== note.file) map.set(target.file, [...(map.get(target.file) ?? []), note])
      }
    }

    return map
  }, [notes, byKey])

  const edges = useMemo(() => {
    const pairs = new Map<string, [string, string]>()

    for (const note of notes) {
      for (const name of memoryLinks(note.body)) {
        const target = byKey.get(memoryKey(name))

        if (!target || target.file === note.file) continue

        const pair: [string, string] = note.file < target.file ? [note.file, target.file] : [target.file, note.file]
        pairs.set(pair.join('>'), pair)
      }
    }

    return [...pairs.values()]
  }, [notes, byKey])

  const chooseView = (next: 'list' | 'graph') => {
    setView(next)

    try {
      localStorage.setItem(MEMORY_VIEW_KEY, next)
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }

  const resolver = { open: (name: string) => openNote(name), exists: (name: string) => byKey.has(memoryKey(name)) }
  const picked = view === 'graph' && open ? notes.find(n => n.file === open) : undefined

  const openNote = (name: string) => {
    const target = byKey.get(memoryKey(name))

    if (view === 'graph') {
      if (target) setOpen(target.file)
      return
    }

    if (!target) return

    setType('all')
    setQuery('')
    setShowAll(true)
    setOpen(target.file)
    requestAnimationFrame(() =>
      document.getElementById(`memory-${target.file}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    )
  }

  return (
    <section className="panel memory" aria-labelledby="memory-title">
      <header className="panel-head">
        <h2 id="memory-title">Memory</h2>
        <div className="segmented" role="radiogroup" aria-label="Memory view">
          {(['list', 'graph'] as const).map(option => (
            <button key={option} type="button" role="radio" aria-checked={view === option} onClick={() => chooseView(option)}>
              {option === 'list' ? 'List' : 'Graph'}
            </button>
          ))}
        </div>
      </header>
      {view === 'graph' ? (
        <>
          <MemoryGraph notes={notes} edges={edges} selected={open} onSelect={file => setOpen(file)} />
          {picked && (
            <article className="graph-note" aria-label={picked.title}>
              <header className="graph-note-head">
                <strong>{picked.title}</strong>
                <span className="memory-meta">
                  <span className="memory-type" data-type={picked.type}>
                    {picked.type}
                  </span>
                  {ago(picked.updatedAt, now)}
                </span>
              </header>
              {(picked.hook || picked.description) && <p className="memory-hook-full">{picked.hook || picked.description}</p>}
              <MemoryBody body={picked.body} links={resolver} backlinks={backlinks.get(picked.file) ?? []} />
            </article>
          )}
        </>
      ) : (
        <>
      <header className="panel-head memory-list-head">
        <div className="filters" role="tablist" aria-label="Memory type">
          <button type="button" role="tab" aria-selected={type === 'all'} onClick={() => setType('all')}>
            All <span className="count">{notes.length}</span>
          </button>
          {MEMORY_TYPES.filter(t => counts[t]).map(t => (
            <button key={t} type="button" role="tab" aria-selected={type === t} onClick={() => setType(t)}>
              {t[0]!.toUpperCase() + t.slice(1)} <span className="count">{counts[t]}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search memory notes"
        />
      </header>
      {matching.length === 0 ? (
        <p className="empty">{q ? 'No note matches that search.' : 'No notes of this type yet.'}</p>
      ) : (
        <ul className="memory-list">
          {shown.map(note => {
            const isOpen = open === note.file

            return (
              <li key={note.file} id={`memory-${note.file}`} className="memory-note" data-open={isOpen}>
                <button
                  type="button"
                  className="memory-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : note.file)}
                >
                  <span className="memory-title">
                    {note.title}
                    {now - note.updatedAt < FRESH_MS && <span className="memory-fresh">new</span>}
                  </span>
                  <span className="memory-meta">
                    <span className="memory-type" data-type={note.type}>
                      {note.type}
                    </span>
                    {ago(note.updatedAt, now)}
                  </span>
                  <span className="memory-hook">{note.hook || note.description}</span>
                </button>
                {isOpen && (
                  <MemoryBody
                    body={note.body}
                    links={resolver}
                    backlinks={backlinks.get(note.file) ?? []}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!q && matching.length > MEMORY_PAGE && (
        <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
          {showAll ? 'Show only the newest' : `Show all ${matching.length} notes`}
        </button>
      )}
        </>
      )}
    </section>
  )
}

const ArtifactsCard = ({ artifacts, sessions, now }: { artifacts: PublishedArtifact[]; sessions: Session[]; now: number }) => {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? artifacts : artifacts.slice(0, 5)

  return (
    <section className="panel artifacts" aria-labelledby="artifacts-title">
      <header className="panel-head">
        <h2 id="artifacts-title">Artifacts</h2>
        <span className="jira-summary">{plural(artifacts.length, 'published page')}</span>
      </header>
      {artifacts.length === 0 ? (
        <p className="empty">No session has published an artifact in the last month.</p>
      ) : (
        <ul className="queue-list">
          {shown.map(artifact => (
            <li key={artifact.url} className="artifact">
              <span className="queued-top">
                <a className="queued-title" href={artifact.url}>
                  {artifact.title}
                </a>
                <span className="queued-when">
                  Version {artifact.version}, {ago(artifact.updatedAt, now)}
                </span>
              </span>
              {artifact.description && <span className="artifact-description">{artifact.description}</span>}
              <SessionLabels linked={sessions.filter(session => artifact.sessionIds.includes(session.id))} />
            </li>
          ))}
        </ul>
      )}
      {artifacts.length > 5 && (
        <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
          {showAll ? 'Show only the newest' : `Show all ${artifacts.length} artifacts`}
        </button>
      )}
    </section>
  )
}

const longDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const BRIEF_SESSIONS = 6

const BriefingSessions = ({ briefing }: { briefing: Briefing }) => {
  const [showAll, setShowAll] = useState(true)
  const shown = showAll ? briefing.sessions : briefing.sessions.slice(0, BRIEF_SESSIONS)
  const worktrees = new Set(briefing.sessions.map(s => s.worktree).filter(Boolean))
  const responses = briefing.sessions.reduce((n, s) => n + s.responses, 0)

  return (
    <div className="brief-col brief-day">
      <h2 className="brief-title">{briefing.isYesterday ? 'Yesterday' : longDay(briefing.day)}</h2>
      {briefing.sessions.length === 0 ? (
        <p className="empty">No Claude session found before today in the last month.</p>
      ) : (
        <>
          <p className="brief-lead">
            You worked in {plural(briefing.sessions.length, 'Claude session')} across{' '}
            {plural(worktrees.size, 'worktree')}, with {plural(responses, 'response')} from Claude.
          </p>
          <ul className="brief-list">
            {shown.map(session => (
              <li key={session.id} className="brief-session">
                <button
                  type="button"
                  className="brief-session-head"
                  data-tooltip="Show this session below, when it is still listed"
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent('claude-console:focus-session', { detail: session.id }))
                  }
                >
                  <span className="brief-session-title">{session.title || 'Untitled session'}</span>
                  <span className="brief-session-meta">
                    {session.worktree}
                    {session.branch && <code>{session.branch}</code>}
                    <span>
                      {clock(session.firstAt)} to {clock(session.lastAt)}, {plural(session.responses, 'response')}
                    </span>
                  </span>
                </button>
                {session.recap && <p className="brief-recap">{session.recap}</p>}
              </li>
            ))}
          </ul>
          {briefing.sessions.length > BRIEF_SESSIONS && (
            <button type="button" className="ghost more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
              {showAll
                ? 'Show only the busiest sessions'
                : `Show ${briefing.sessions.length - BRIEF_SESSIONS} smaller sessions`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

const eventLabel = (event: PrEvent, reviewer: string) =>
  event === 'waiting'
    ? `Waiting for ${reviewer}`
    : event === 'rejected'
      ? `Rejected by ${reviewer}`
      : { opened: 'Opened', merged: 'Merged', closed: 'Closed', open: 'Open' }[event]

const prLead = (prs: BriefPr[]) => {
  const count = (event: PrEvent) => prs.filter(pr => pr.event === event).length
  const parts = [
    [count('opened'), 'opened'],
    [count('merged'), 'merged'],
    [count('closed') + count('rejected'), 'closed'],
  ].filter(([n]) => n) as Array<[number, string]>
  const stillOpen = count('opened') + count('open') + count('waiting')
  const moved = parts.length ? `Since yesterday: ${parts.map(([n, what]) => `${n} ${what}`).join(', ')}.` : 'Nothing moved since yesterday.'

  return `${moved} ${plural(stillOpen, 'pull request')} still open.`
}

// The day at a glance, across the whole page: what the last working day held,
// what is open now, and what is in development.
// Links for the ticket keys in a summary: those of your tickets, and any other
// key of the same Jira projects, built from your tickets' address. Keys of
// other projects, and look-alikes such as UTF-8, stay plain text.
const ticketLinks = (issues: JiraIssue[], text: string) => {
  const links = new Map(issues.map(issue => [issue.key, issue.url] as const))
  const browse = new Map(
    issues.map(issue => [issue.key.split('-')[0]!, issue.url.slice(0, issue.url.length - issue.key.length)] as const),
  )

  for (const key of text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []) {
    const base = browse.get(key.split('-')[0]!)

    if (base && !links.has(key)) links.set(key, `${base}${key}`)
  }

  return links
}

const SummaryText = ({ tokens }: { tokens: SummaryToken[] }) => (
  <>
    {tokens.map((token, at) =>
      token.kind === 'bold' ? (
        <strong key={at}>
          <SummaryText tokens={token.children} />
        </strong>
      ) : token.kind === 'link' ? (
        <a key={at} href={token.url}>
          {token.text}
        </a>
      ) : (
        <span key={at}>{token.text}</span>
      ),
    )}
  </>
)

const regenerateSummary = () =>
  fetch('/api/briefing/regenerate', { method: 'POST', headers: { 'X-Claude-Console': '1' } })
    .catch(() => null)
    .then(() => window.dispatchEvent(new Event('claude-console:refresh')))

// The briefing written by Claude: a headline, a short account of the last
// working day, and what comes next, with pull requests and tickets linked.
const BriefingSummaryView = ({
  summary,
  prUrls,
  ticketUrls,
  now,
}: {
  summary: Snapshot['summary']
  prUrls: ReadonlyMap<number, string>
  ticketUrls: ReadonlyMap<string, string>
  now: number
}) => {
  const [isAsking, setIsAsking] = useState(false)
  const isWriting = summary.status === 'writing' || isAsking
  const paragraphs = summaryParagraphs(summary.text, prUrls, ticketUrls)

  useEffect(() => {
    if (summary.status !== 'writing') setIsAsking(false)
  }, [summary.status, summary.generatedAt])

  return (
    <div className="brief-summary" aria-busy={isWriting || undefined}>
      {paragraphs.length > 0 ? (
        <div className="brief-summary-text">
          {paragraphs.map((tokens, at) =>
            at === 0 ? (
              <p key={at} className="brief-summary-headline">
                <SummaryText tokens={tokens} />
              </p>
            ) : (
              <p key={at}>
                <SummaryText tokens={tokens} />
              </p>
            ),
          )}
        </div>
      ) : isWriting ? null : (
        <p className="empty">The summary could not be written{summary.error ? `: ${summary.error}` : '.'}</p>
      )}
      <p className="brief-summary-meta" role="status">
        {isWriting ? (
          <>
            <span className="sync" data-busy="true" aria-hidden />
            Claude is writing your summary…
          </>
        ) : (
          <>
            {summary.generatedAt > 0 && (
              <span data-tooltip={new Date(summary.generatedAt).toLocaleString()}>
                Written by Claude {summary.model && `(${summary.model})`} {ago(summary.generatedAt, now)}
              </span>
            )}
            {summary.error && paragraphs.length > 0 && (
              <span className="brief-summary-error" data-tooltip={summary.error}>
                Last update failed
              </span>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setIsAsking(true)
                void regenerateSummary()
              }}
            >
              Regenerate
            </button>
          </>
        )}
      </p>
    </div>
  )
}

const BriefingCard = ({ snapshot, now }: { snapshot: Snapshot; now: number }) => {
  const [isOpen, setIsOpen] = useState(false)
  const briefing = snapshot.briefing
  const prs = briefingPrs(
    snapshot.recentPrs ?? [],
    snapshot.prs.filter(pr => now - pr.updatedAt < 30 * 86_400_000),
    snapshot.queue,
    now,
  )
  const developing = snapshot.jira.filter(issue => issue.statusCategory === 'indeterminate')
  const profile = snapshot.profile
  const firstName = profile?.name.split(' ')[0] ?? ''
  const summary = snapshot.summary
  const hasSummary = summary.status !== 'off'
  const [showDetails, setShowDetails] = useState(false)
  const prUrls = new Map([...snapshot.prs, ...prs].map(pr => [pr.number, pr.url] as const))
  const ticketUrls = ticketLinks(snapshot.jira, summary.text)
  const isGridShown = !hasSummary || showDetails || summary.status === 'error'

  return (
    <section className="panel briefing" data-open={isOpen} aria-labelledby="briefing-title">
      <header className="brief-head">
        <div className="brief-identity">
          {profile && (
            <a className="brief-photo-link" href={profile.url} data-tooltip={`${profile.name} on GitHub`}>
              <img className="brief-photo" src={profile.avatarUrl} alt="" width={64} height={64} />
            </a>
          )}
          <div className="brief-who">
            <h2 id="briefing-title" className="brief-greeting">
              {greeting(now)}
              {firstName && `, ${firstName}`}
            </h2>
            {profile?.bio && <p className="brief-bio">{profile.bio}</p>}
          </div>
        </div>
        <button
          type="button"
          className="brief-toggle"
          aria-expanded={isOpen}
          aria-controls="briefing-body"
          onClick={() => setIsOpen(v => !v)}
        >
          {isOpen ? 'Hide your summary' : 'Read your summary'}
        </button>
      </header>
      <div id="briefing-body" hidden={!isOpen}>
      {hasSummary && <BriefingSummaryView summary={summary} prUrls={prUrls} ticketUrls={ticketUrls} now={now} />}
      {hasSummary && summary.status !== 'error' && (
        <button
          type="button"
          className="ghost more brief-details-toggle"
          aria-expanded={showDetails}
          aria-controls="briefing-details"
          onClick={() => setShowDetails(v => !v)}
        >
          {showDetails ? 'Hide details' : 'Show details: sessions, pull requests and tickets'}
        </button>
      )}
      <div className="brief-grid" id="briefing-details" hidden={!isGridShown} data-columns={snapshot.features.jira ? 3 : 2}>
        {briefing ? <BriefingSessions briefing={briefing} /> : <p className="empty">Reading yesterday's sessions…</p>}
        <div className="brief-col">
          <h2 className="brief-title">Pull requests</h2>
          {prs.length === 0 ? (
            <p className="empty">Nothing opened, merged, or closed since yesterday, and nothing open.</p>
          ) : (
            <>
              <p className="brief-lead">{prLead(prs)}</p>
              <ul className="brief-list">
                {prs.map(pr => (
                  <li key={pr.url} className="brief-item" data-event={pr.event} data-ci={pr.ci ?? undefined}>
                    <a href={pr.url}>
                      #{pr.number} {pr.title}
                    </a>
                    <span className="brief-item-meta">
                      <span className="brief-event" data-event={pr.event}>
                        {eventLabel(pr.event, snapshot.features.reviewQueue?.name ?? '')}
                      </span>
                      {pr.day ? ` ${pr.day} at ${clock(pr.at)}` : ''}
                      {pr.ci && pr.ci !== 'none' && `, ${CI_LABEL[pr.ci]}`}, {pr.repo}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {snapshot.features.jira && (
          <div className="brief-col">
            <h2 className="brief-title">In development</h2>
            {developing.length === 0 ? (
              <p className="empty">No ticket in progress.</p>
            ) : (
              <>
                <p className="brief-lead">You are working on {plural(developing.length, 'ticket')}.</p>
                <ul className="brief-list">
                  {developing.map(issue => (
                    <li key={issue.key} className="brief-item">
                      <a href={issue.url}>
                        <code>{issue.key}</code> {issue.summary}
                      </a>
                      <span className="brief-item-meta">{issue.status}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </section>
  )
}

const LEVEL_TEXT = { good: 'plenty left', warning: 'over half used', critical: 'close to the limit' } as const

const levelOf = (percent: number) => (percent >= 80 ? 'critical' : percent >= 50 ? 'warning' : 'good')

const Meter = ({ label, window, now, resetFormat }: {
  label: string
  window: UsageWindow | null
  now: number
  resetFormat: (ms: number) => string
}) => {
  if (!window) {
    return (
      <div className="meter">
        <span className="meter-label">{label}</span>
        <span className="meter-empty">Not reported yet</span>
      </div>
    )
  }

  const level = levelOf(window.percent)

  return (
    <div className="meter" data-level={level}>
      <span className="meter-label">{label}</span>
      <span
        className="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={window.percent}
        aria-label={`${label}: ${window.percent}% used`}
      >
        <span className="meter-fill" style={{ width: `${Math.min(100, window.percent)}%` }} />
      </span>
      <span className="meter-value">{Math.round(window.percent)}%</span>
      <span className="meter-note">
        {LEVEL_TEXT[level]}
        {window.resetsAt && <>, resets {resetFormat(window.resetsAt)}</>}
      </span>
    </div>
  )
}

const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, opts)

const UsageCard = ({ usage, now }: { usage: Usage | null; now: number }) => {
  const [focus, setFocus] = useState<number | null>(null)

  if (!usage) {
    return (
      <section className="panel usage" aria-labelledby="usage-title">
        <header className="panel-head">
          <h2 id="usage-title">Claude usage</h2>
        </header>
        <p className="empty">Counting tokens in your transcripts…</p>
      </section>
    )
  }

  const today = usage.days[usage.days.length - 1]!
  const peak = Math.max(...usage.days.map(d => d.output), 1)
  const shown = focus === null ? null : usage.days[focus]!

  return (
    <section className="panel usage" aria-labelledby="usage-title">
      <header className="panel-head">
        <h2 id="usage-title">Claude usage</h2>
        {usage.windowsReportedAt > 0 && (
          <span className="usage-reported">limits reported {ago(usage.windowsReportedAt, now)}</span>
        )}
      </header>
      <div className="meters">
        <Meter
          label="5-hour window"
          window={usage.fiveHour}
          now={now}
          resetFormat={ms => `${until(ms, now)}, at ${new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
        />
        <Meter
          label="7-day window"
          window={usage.sevenDay}
          now={now}
          resetFormat={ms =>
            new Date(ms).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' })
          }
        />
      </div>
      <dl className="today">
        <div>
          <dt>Output today</dt>
          <dd>{compact(today.output)} tokens</dd>
        </div>
        <div>
          <dt>Responses today</dt>
          <dd>{today.responses.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Read from cache</dt>
          <dd>{compact(today.cacheRead)} tokens</dd>
        </div>
        {usage.todayCost !== null && (
          <div data-tooltip="Sum of the cost the status line reports for each session seen today, at API prices">
            <dt>At API prices</dt>
            <dd>${usage.todayCost.toFixed(2)}</dd>
          </div>
        )}
      </dl>
      <figure className="chart">
        <figcaption className="chart-caption">
          <span>Output tokens per day, last 14 days</span>
          <span className="chart-peak">peak {compact(peak)}</span>
        </figcaption>
        <div className="bars" onMouseLeave={() => setFocus(null)}>
          {usage.days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className="bar-hit"
              data-today={i === usage.days.length - 1}
              aria-label={`${dayLabel(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${compact(d.output)} output tokens, ${d.responses} responses`}
              onMouseEnter={() => setFocus(i)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
            >
              <span className="bar" style={{ height: `${Math.max(d.output ? 3 : 0, (d.output / peak) * 100)}%` }} />
            </button>
          ))}
          {shown && focus !== null && (
            <div
              className="tip"
              role="status"
              style={{ left: `${((focus + 0.5) / usage.days.length) * 100}%` }}
              data-edge={focus < 3 ? 'start' : focus > usage.days.length - 4 ? 'end' : undefined}
            >
              <strong>{dayLabel(shown.date, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
              <span>{compact(shown.output)} output tokens</span>
              <span>{compact(shown.input + shown.cacheRead + shown.cacheWrite)} input incl. cache</span>
              <span>{shown.responses.toLocaleString()} responses</span>
              {Object.keys(shown.byModel).length > 1 && <span>{Object.keys(shown.byModel).join(', ')}</span>}
            </div>
          )}
        </div>
        <div className="axis" aria-hidden>
          <span>{dayLabel(usage.days[0]!.date, { day: 'numeric', month: 'short' })}</span>
          <span>Today</span>
        </div>
        <table className="sr-only">
          <caption>Output tokens per day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Output tokens</th>
              <th scope="col">Responses</th>
            </tr>
          </thead>
          <tbody>
            {usage.days.map(d => (
              <tr key={d.date}>
                <th scope="row">{d.date}</th>
                <td>{d.output}</td>
                <td>{d.responses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </section>
  )
}

// Opens a folder in a new tab of the configured terminal, resuming a Claude
// Code session there when one is named.
const openTab = async (dir: string, session?: string, isRemote = false) => {
  const response = await fetch('/api/terminal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify({ dir, session, ...(isRemote ? { remote: true } : {}) }),
  })

  return response.ok
}

// Links leave the console's app window for the person's own browser profile,
// where they are signed in to GitHub, Jira and the rest.
const useExternalLinks = () => {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || (event.type === 'click' && event.button !== 0)) return

      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null

      if (!anchor) return

      const url = new URL(anchor.href, location.href)

      if (url.protocol === 'ghosttycd:') {
        event.preventDefault()
        void openTab(decodeURIComponent(url.pathname || anchor.href.replace(/^ghosttycd:\/\//, '')))
        return
      }

      if (url.origin === location.origin) return

      event.preventDefault()
      void fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
        body: JSON.stringify({ url: url.href }),
      })
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)

    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onClick, true)
    }
  }, [])
}

// A page opened from the status line's link carries ?session=<id>: show that
// session once the data is in, and drop the parameter so a reload stays quiet.
const useSessionFromUrl = (isReady: boolean) => {
  const handled = useRef(false)

  useEffect(() => {
    if (!isReady || handled.current) return

    handled.current = true

    const session = new URLSearchParams(location.search).get('session')

    if (!session) return

    history.replaceState(null, '', location.pathname)
    requestAnimationFrame(() =>
      window.dispatchEvent(new CustomEvent('claude-console:focus-session', { detail: session })),
    )
  }, [isReady])
}

const TOOLTIP_ID = 'console-tooltip'
const TOOLTIP_DELAY_MS = 350
const TOOLTIP_GAP = 8

type Tip = { text: string; x: number; top: number; bottom: number }

// One tooltip for the whole page, in the look of the session recap: any element
// with data-tooltip shows its text above it (or below, near the top of the
// window) after a short pause on hover, or at once on keyboard focus. It is tied
// to the element with aria-describedby while it shows.
const TooltipLayer = () => {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let target: HTMLElement | null = null

    const hide = () => {
      clearTimeout(timer)

      if (target?.getAttribute('aria-describedby') === TOOLTIP_ID) target.removeAttribute('aria-describedby')

      target = null
      setTip(null)
    }

    const show = (element: HTMLElement, delay: number) => {
      hide()
      target = element
      timer = setTimeout(() => {
        const text = element.dataset.tooltip

        if (!text || !element.isConnected) return

        const rect = element.getBoundingClientRect()

        if (!element.hasAttribute('aria-describedby')) element.setAttribute('aria-describedby', TOOLTIP_ID)

        setTip({ text, x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom })
      }, delay)
    }

    const tooltipOf = (node: EventTarget | null) =>
      (node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null) ?? null

    const onOver = (event: PointerEvent) => {
      const element = tooltipOf(event.target)

      if (element === target) return
      if (element) show(element, TOOLTIP_DELAY_MS)
      else hide()
    }

    const onFocusIn = (event: FocusEvent) => {
      const element = tooltipOf(event.target)

      if (element && element.matches(':focus-visible')) show(element, 0)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)

    return () => {
      hide()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Placed once its size is known: above when it fits, otherwise below, and
  // always inside the window.
  useLayoutEffect(() => {
    if (!tip || !box.current) {
      setPlace(null)
      return
    }

    const { width, height } = box.current.getBoundingClientRect()
    const fitsAbove = tip.top - height - TOOLTIP_GAP > 4
    const left = Math.min(Math.max(8, tip.x - width / 2), window.innerWidth - width - 8)

    setPlace({ left, top: fitsAbove ? tip.top - height - TOOLTIP_GAP : tip.bottom + TOOLTIP_GAP })
  }, [tip])

  if (!tip) return null

  return (
    <div
      ref={box}
      id={TOOLTIP_ID}
      role="tooltip"
      className="tooltip"
      style={place ? { left: place.left, top: place.top } : { left: -9999, top: -9999 }}
    >
      {tip.text}
    </div>
  )
}

type PageTab = 'dashboard' | 'knowledge' | 'settings'


const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

// The window bar's pet: on or off, which pet, and which color, each either fixed
// or drawn at random. Changes apply at once.
const PetSettingsCard = () => {
  const [settings, setSettings] = useState<PetSettings | null>(null)
  const [options, setOptions] = useState<PetOptions>({})
  const [error, setError] = useState('')
  const [isLoadingOptions, setIsLoadingOptions] = useState(true)
  const [size, setSize] = useState(30)
  // Only the answer to the latest save counts; an earlier one arriving late
  // must not undo a newer choice.
  const lastSave = useRef(0)

  useEffect(() => {
    fetch('/api/pet-settings')
      .then(response => response.json() as Promise<{ settings: PetSettings; options: PetOptions }>)
      .then(body => {
        setSettings(body.settings)
        setSize(body.settings.size)
        setOptions(body.options)
      })
      .catch(() => setError('The pet settings could not be read.'))
      .finally(() => setIsLoadingOptions(false))
  }, [])

  const save = async (change: Partial<PetSettings>) => {
    if (!settings) return

    const previous = settings
    const id = (lastSave.current += 1)

    setSettings({ ...settings, ...change })
    setError('')

    const response = await fetch('/api/pet-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
      body: JSON.stringify(change),
    }).catch(() => null)
    const body = ((await response?.json().catch(() => null)) ?? {}) as { settings?: PetSettings; error?: string }

    if (id !== lastSave.current) return

    if (response?.ok && body.settings) {
      setSettings(body.settings)
      window.dispatchEvent(new Event(SYSTEM_REFRESH))
    } else {
      setSettings(previous)
      setError(body.error ?? 'The change could not be saved.')
    }
  }

  const kinds = Object.keys(options).filter(kind => options[kind]!.length > 0)
  const colors = settings?.kind ? options[settings.kind] ?? [] : []
  const preview = settings?.kind && settings.color ? `/api/pet/${settings.kind}/${settings.color}_idle_8fps.gif` : ''

  return (
    <section className="panel pet-settings" aria-labelledby="pet-settings-title">
      <header className="panel-head">
        <h2 id="pet-settings-title">Pet</h2>
      </header>
      {!settings ? (
        <p className="empty">{error || 'Reading the pet settings…'}</p>
      ) : (
        <div className="settings-form">
          <label className="switch-row">
            <span className="switch-text">
              <span className="setting-label">Show a pet in the window bar</span>
              <span className="setting-hint">
                A pet from vscode-pets walks the empty bar; click it to throw balls.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={settings.isEnabled}
              onClick={() => void save({ isEnabled: !settings.isEnabled })}
            >
              <span className="switch-thumb" aria-hidden="true" />
            </button>
          </label>
          <div className="setting-row" data-disabled={!settings.isEnabled || undefined}>
            <label className="setting-field">
              <span className="setting-label">Pet</span>
              <select
                value={settings.kind}
                disabled={!settings.isEnabled || isLoadingOptions}
                onChange={event => void save({ kind: event.target.value, color: '' })}
              >
                <option value="">Random each start</option>
                {kinds.map(kind => (
                  <option key={kind} value={kind}>
                    {titleCase(kind.replace(/-/g, ' '))}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field">
              <span className="setting-label">Color</span>
              <select
                value={settings.color}
                disabled={!settings.isEnabled || !settings.kind}
                onChange={event => void save({ color: event.target.value })}
              >
                <option value="">Random</option>
                {colors.map(color => (
                  <option key={color} value={color}>
                    {titleCase(color.replace(/([a-z])(brown|gray|white)$/, '$1 $2'))}
                  </option>
                ))}
              </select>
            </label>
            <div className="pet-preview" aria-hidden="true">
              {preview ? <img src={preview} alt="" width={60} /> : <span>{settings.kind ? 'Any color' : 'Any pet'}</span>}
            </div>
          </div>
          <div className="setting-field setting-size" data-disabled={!settings.isEnabled || undefined}>
            <label className="setting-label" htmlFor="pet-size">
              Size <output htmlFor="pet-size">{size}px</output>
            </label>
            <input
              id="pet-size"
              type="range"
              min={16}
              max={80}
              step={2}
              value={size}
              disabled={!settings.isEnabled}
              onChange={event => setSize(Number(event.target.value))}
              onPointerUp={() => size !== settings.size && void save({ size })}
              onKeyUp={() => size !== settings.size && void save({ size })}
              aria-describedby="pet-size-hint"
            />
            <span id="pet-size-hint" className="setting-hint">
              The sprite's width; 30px is the vscode-pets default. Above about 50px, taller pets go past the 40px bar.
            </span>
          </div>
          {settings.isEnabled && kinds.length === 0 && !isLoadingOptions && (
            <p className="setting-hint">
              The pets could not be fetched from the Visual Studio Marketplace; they are tried again on the next start.
            </p>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

const PAGE_TAB_KEY = 'claude-console:page'

const readPageTab = (): PageTab => {
  try {
    const stored = localStorage.getItem(PAGE_TAB_KEY)

    return stored === 'knowledge' || stored === 'settings' ? stored : 'dashboard'
  } catch {
    return 'dashboard'
  }
}

const PAGE_TABS: Array<{ id: PageTab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'knowledge', label: 'Claude Knowledge' },
  { id: 'settings', label: 'Configurations' },
]

const CogIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path
      d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
)

const PageTabs = ({ tab, onChoose }: { tab: PageTab; onChoose: (next: PageTab) => void }) => (
  <div className="page-tabs" role="tablist" aria-label="Console pages">
    {PAGE_TABS.map(option => (
      <button
        key={option.id}
        type="button"
        role="tab"
        id={`page-tab-${option.id}`}
        aria-selected={tab === option.id}
        aria-controls="page-panel"
        aria-label={option.id === 'settings' ? option.label : undefined}
        data-tooltip={option.id === 'settings' ? option.label : undefined}
        className={option.id === 'settings' ? 'page-tab-icon' : undefined}
        tabIndex={tab === option.id ? 0 : -1}
        onClick={() => onChoose(option.id)}
        onKeyDown={event => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return

          event.preventDefault()

          const at = PAGE_TABS.findIndex(o => o.id === tab)
          const next = PAGE_TABS[(at + (event.key === 'ArrowRight' ? 1 : PAGE_TABS.length - 1)) % PAGE_TABS.length]!

          onChoose(next.id)
          document.getElementById(`page-tab-${next.id}`)?.focus()
        }}
      >
        {option.id === 'settings' ? <CogIcon /> : option.label}
      </button>
    ))}
  </div>
)

// Keeps the chosen page across visits, and comes back to the dashboard when
// something asks to show a session, which only the dashboard lists.
const usePageTab = () => {
  const [tab, setTab] = useState<PageTab>(readPageTab)

  const choose = useCallback((next: PageTab) => {
    setTab(next)

    try {
      localStorage.setItem(PAGE_TAB_KEY, next)
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }, [])

  useEffect(() => {
    const onFocus = (event: Event) => {
      if (readPageTab() === 'dashboard' && tab === 'dashboard') return

      choose('dashboard')

      // The sessions panel was not mounted to hear it: ask again once it is.
      const detail = (event as CustomEvent<string>).detail

      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('claude-console:focus-session', { detail }))),
      )
    }

    if (tab === 'dashboard') return

    window.addEventListener('claude-console:focus-session', onFocus)

    return () => window.removeEventListener('claude-console:focus-session', onFocus)
  }, [tab, choose])

  return [tab, choose] as const
}

const isLoadingPreview = new URLSearchParams(window.location.search).has('loading')

export const App = () => {
  const { snapshot, error, isRefreshing, isFetching, refresh } = useSnapshot()
  const now = useNow()
  const [ticket] = useTicketParam()

  useTicketHistory()

  useSessionFromUrl(!!snapshot)

  useExternalLinks()

  const [page, choosePage] = usePageTab()

  const title = snapshot?.features.title

  useEffect(() => {
    if (!snapshot) return

    syncFavorites(snapshot.favorites, snapshot.generatedAt)
    syncNames(snapshot.names, snapshot.generatedAt)
  }, [snapshot])

  useEffect(() => {
    if (title) document.title = title
  }, [title])

  // ?loading keeps the loading screen up, to look at it.
  if (!snapshot || isLoadingPreview) {
    return <EmojiLoader message={error ? `Unable to load the console: ${error}` : 'Reading worktrees, pull requests and sessions…'} />
  }

  const problems = [
    error && `Live updates stopped: ${error}`,
    snapshot.errors.worktrees && `Worktrees could not be read: ${snapshot.errors.worktrees}`,
    snapshot.errors.prs && `Pull requests could not be read (check \`gh auth status\`): ${snapshot.errors.prs}`,
    snapshot.errors.usage && `Usage could not be read from the transcripts: ${snapshot.errors.usage}`,
    snapshot.errors.jira && `Jira tickets could not be read: ${snapshot.errors.jira}`,
    snapshot.errors.queue && `The review queue could not be read: ${snapshot.errors.queue}`,
    snapshot.errors.contributions && `Activity could not be read: ${snapshot.errors.contributions}`,
    snapshot.errors.memory && `Memory could not be read: ${snapshot.errors.memory}`,
    snapshot.errors.skills && `Skills could not be read: ${snapshot.errors.skills}`,
    snapshot.errors.knowledge && `Claude's setup could not be read: ${snapshot.errors.knowledge}`,
    snapshot.errors.artifacts && `Artifacts could not be read: ${snapshot.errors.artifacts}`,
  ].filter(Boolean)

  return (
    <>
      <WindowBar title={snapshot.features.title} hasIcon={snapshot.features.hasIcon} />
      <ConfirmHost />
      <TooltipLayer />
      <main className="shell">
        <BurstLayer />
        <header className="top">
          <div className="top-line">
            <code className="repo">{snapshot.repo}</code>
            <span className="updated">
              <span
                className="sync"
                data-busy={isFetching || isRefreshing}
                role="status"
                aria-label={isFetching || isRefreshing ? 'Updating now' : 'Live: updates every 10 seconds'}
                data-tooltip={isFetching || isRefreshing ? 'Updating now' : 'Live: updates every 10 seconds'}
              />
              Worktrees {ago(snapshot.worktreesAt, now)}, pull requests {ago(snapshot.prsAt, now)}
            </span>
            <ThemeSwitch />
            <button type="button" onClick={refresh} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
          {problems.map(p => (
            <p key={p as string} className="problem" role="alert">
              {p}
            </p>
          ))}
        </header>
        <TicketKeys.Provider value={snapshot.jira.map(issue => issue.key)}>
        {ticket ? (
          <TicketView
            issue={snapshot.jira.find(issue => issue.key === ticket)}
            ticketKey={ticket}
            snapshot={snapshot}
            renderWorktree={w => <WorktreeRow key={w.path} worktree={w} now={now} />}
            renderSession={s => (
              <SessionRow
                key={s.id}
                session={s}
                now={now}
                worktrees={snapshot.worktrees}
                live={null}
                prs={snapshot.prs}
                queue={snapshot.queue}
                artifacts={snapshot.artifacts}
              />
            )}
          />
        ) : (
        <>
        <BriefingCard snapshot={snapshot} now={now} />
        <PageTabs tab={page} onChoose={choosePage} />
        <div id="page-panel" role="tabpanel" aria-labelledby={`page-tab-${page}`}>
        {page === 'dashboard' ? (
          <>
            <div className="grid">
              <div className="column">
                <Sessions
                  sessions={snapshot.sessions}
                  now={now}
                  worktrees={snapshot.worktrees}
                  prs={snapshot.prs}
                  queue={snapshot.queue}
                  artifacts={snapshot.artifacts}
                  newSession={snapshot.features.newSession}
                  repo={snapshot.repo}
                  favoriteSessions={snapshot.favoriteSessions}
                />
                <Worktrees worktrees={snapshot.worktrees} now={now} />
                <PullRequests
                  prs={snapshot.prs}
                  assigned={snapshot.assignedPrs}
                  now={now}
                  sessions={snapshot.sessions}
                  setup={snapshot.features.newSession}
                  repo={snapshot.repo}
                />
                {snapshot.features.jira && (
                  <JiraTickets
                    issues={snapshot.jira}
                    worktrees={snapshot.worktrees}
                    prs={snapshot.prs}
                    sessions={snapshot.sessions}
                    now={now}
                    newSession={snapshot.features.newSession}
                    startWork={snapshot.features.startWork}
                    repo={snapshot.repo}
                  />
                )}
              </div>
              <div className="column">
                {snapshot.features.services && <ServicesPanel sessions={snapshot.sessions} now={now} />}
                <ContributionsCard contributions={snapshot.contributions} />
                <UsageCard usage={snapshot.usage} now={now} />
                {snapshot.features.reviewQueue && (
                  <ReviewQueuePanel queue={snapshot.queue} setup={snapshot.features.reviewQueue} now={now} />
                )}
              </div>
            </div>
          </>
        ) : page === 'settings' ? (
          <div className="settings-page">
            <PetSettingsCard />
          </div>
        ) : (
          <div className="knowledge">
            <div className="grid knowledge-wide">
              <MemoryCard notes={snapshot.memory} now={now} />
              <ArtifactsCard artifacts={snapshot.artifacts} sessions={snapshot.sessions} now={now} />
            </div>
            <div className="grid knowledge-wide">
              <SkillsCard skills={snapshot.skills} now={now} />
              <McpCard mcp={snapshot.knowledge.mcp} now={now} />
            </div>
            <div className="grid knowledge-wide">
              <InstructionsCard items={snapshot.knowledge.instructions} now={now} />
              <HooksCard hooks={snapshot.knowledge.hooks} />
            </div>
            <div className="grid knowledge-wide">
              <ExtensionsCard extensions={snapshot.knowledge.extensions} />
            </div>
          </div>
        )}
      </div>
        </>
        )}
        </TicketKeys.Provider>
      </main>
      <footer className="credit">
        <a href="https://github.com/interaminense">@interaminense</a>
      </footer>
    </>
  )
}
