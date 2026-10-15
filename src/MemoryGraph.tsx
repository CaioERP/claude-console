import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { MemoryNote } from '../shared/types'

type GraphNode = SimulationNodeDatum & { id: string; note: MemoryNote; degree: number }
type GraphLink = SimulationLinkDatum<GraphNode>

const HEIGHT = 520
const LABEL_DEGREE = 8
const FIT_PADDING = 36
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export const radiusOf = (degree: number) => 4 + Math.sqrt(degree) * 2.2

// Claude's memory as a force-directed graph, the way Obsidian draws a vault:
// one dot per note, one line per [[link]], dots growing with their links and
// colored by type. Wheel zooms, dragging the background pans, dragging a dot
// pulls its neighborhood, and hovering a dot lights it and its neighbors up.
export const MemoryGraph = ({
  notes,
  edges,
  selected,
  onSelect,
}: {
  notes: MemoryNote[]
  edges: Array<[string, string]>
  selected: string | null
  onSelect: (file: string) => void
}) => {
  const svg = useRef<SVGSVGElement>(null)
  const simulation = useRef<Simulation<GraphNode, GraphLink> | null>(null)
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const [, setFrame] = useState(0)
  const [width, setWidth] = useState(800)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState<string | null>(null)
  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; startX: number; startY: number; moved: boolean } | null>(null)
  const touched = useRef(false)
  const widthRef = useRef(800)

  const signature = `${notes.map(n => n.file).join('|')}#${edges.map(e => e.join('>')).join('|')}`

  const { nodes, links, neighbors } = useMemo(() => {
    const degree = new Map<string, number>()

    for (const [a, b] of edges) {
      degree.set(a, (degree.get(a) ?? 0) + 1)
      degree.set(b, (degree.get(b) ?? 0) + 1)
    }

    const nodes: GraphNode[] = notes.map(note => ({
      id: note.file,
      note,
      degree: degree.get(note.file) ?? 0,
      ...(positions.current.get(note.file) ?? {}),
    }))
    const links: GraphLink[] = edges.map(([source, target]) => ({ source, target }))
    const neighbors = new Map<string, Set<string>>(notes.map(n => [n.file, new Set<string>()]))

    for (const [a, b] of edges) {
      neighbors.get(a)?.add(b)
      neighbors.get(b)?.add(a)
    }

    return { nodes, links, neighbors }
    // The graph only rebuilds when its notes or links change, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Zooms and centers the view so every dot fits, until the person zooms or
  // pans themselves.
  const fit = () => {
    if (touched.current || nodes.length === 0) return

    // Fits the bulk of the graph: a stray dot or two at the edges should not
    // shrink everything else.
    const xs = nodes.map(n => n.x ?? 0).sort((a, b) => a - b)
    const ys = nodes.map(n => n.y ?? 0).sort((a, b) => a - b)
    const edge = Math.floor(nodes.length * 0.02)
    const [minX, maxX] = [xs[edge]!, xs[xs.length - 1 - edge]!]
    const [minY, maxY] = [ys[edge]!, ys[ys.length - 1 - edge]!]
    const k = Math.min(
      2,
      (widthRef.current - FIT_PADDING * 2) / Math.max(1, maxX - minX),
      (HEIGHT - FIT_PADDING * 2) / Math.max(1, maxY - minY),
    )

    setView({ k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k })
  }

  useEffect(() => {
    const sim = forceSimulation(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(46).strength(0.35))
      .force('charge', forceManyBody().strength(-130))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<GraphNode>(d => radiusOf(d.degree) + 3))
      .force('x', forceX<GraphNode>(0).strength(d => (d.degree === 0 ? 0.25 : 0.05)))
      .force('y', forceY<GraphNode>(0).strength(d => (d.degree === 0 ? 0.25 : 0.07)))
      .on('tick', () => {
        for (const node of nodes) positions.current.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 })
        setFrame(f => f + 1)

        if (sim.alpha() > 0.05) fit()
      })
      .on('end', fit)

    if (reducedMotion()) {
      sim.stop()
      sim.tick(300)
      for (const node of nodes) positions.current.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 })
      setFrame(f => f + 1)
      fit()
    }

    simulation.current = sim

    return () => {
      sim.stop()
    }
  }, [nodes, links])

  useEffect(() => {
    const element = svg.current

    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      widthRef.current = entry!.contentRect.width
      setWidth(entry!.contentRect.width)
    })
    observer.observe(element)

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      touched.current = true

      const rect = element.getBoundingClientRect()
      const px = event.clientX - rect.left - rect.width / 2
      const py = event.clientY - rect.top - HEIGHT / 2

      setView(v => {
        const k = Math.min(4, Math.max(0.3, v.k * Math.exp(-event.deltaY * 0.0015)))

        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
      })
    }

    element.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      observer.disconnect()
      element.removeEventListener('wheel', onWheel)
    }
  }, [])

  const toGraph = (clientX: number, clientY: number) => {
    const rect = svg.current!.getBoundingClientRect()

    return {
      x: (clientX - rect.left - rect.width / 2 - view.x) / view.k,
      y: (clientY - rect.top - HEIGHT / 2 - view.y) / view.k,
    }
  }

  const onPointerDown = (event: React.PointerEvent, id?: string) => {
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    drag.current = { kind: id ? 'node' : 'pan', id, startX: event.clientX, startY: event.clientY, moved: false }

    if (id) {
      const node = nodes.find(n => n.id === id)!
      node.fx = node.x
      node.fy = node.y
      simulation.current?.alphaTarget(0.25).restart()
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current

    if (!current) return

    if (Math.abs(event.clientX - current.startX) + Math.abs(event.clientY - current.startY) > 3) current.moved = true

    if (current.kind === 'pan') {
      touched.current = true
      setView(v => ({ ...v, x: v.x + event.movementX, y: v.y + event.movementY }))
    } else {
      const node = nodes.find(n => n.id === current.id)!
      const point = toGraph(event.clientX, event.clientY)
      node.fx = point.x
      node.fy = point.y
    }
  }

  const onPointerUp = () => {
    const current = drag.current
    drag.current = null

    if (current?.kind !== 'node') return

    const node = nodes.find(n => n.id === current.id)!
    node.fx = null
    node.fy = null
    simulation.current?.alphaTarget(0)

    if (!current.moved) onSelect(node.id)
  }

  const focus = hover ?? selected
  const lit = focus ? new Set([focus, ...(neighbors.get(focus) ?? [])]) : null
  const byId = new Map(nodes.map(n => [n.id, n]))

  return (
    <div className="graph">
      <svg
        ref={svg}
        className="graph-canvas"
        height={HEIGHT}
        role="img"
        aria-label={`${nodes.length} memory notes and ${links.length} links between them; use the List tab to read them`}
        onPointerDown={event => onPointerDown(event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${width / 2 + view.x} ${HEIGHT / 2 + view.y}) scale(${view.k})`}>
          {links.map((link, i) => {
            const a = link.source as GraphNode
            const b = link.target as GraphNode
            const isLit = lit ? lit.has(a.id) && lit.has(b.id) && (a.id === focus || b.id === focus) : false

            return (
              <line
                key={i}
                className="graph-edge"
                data-lit={isLit}
                data-dim={!!lit && !isLit}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              />
            )
          })}
          {nodes.map(node => {
            const r = radiusOf(node.degree)
            const isDim = !!lit && !lit.has(node.id)
            const showLabel = node.degree >= LABEL_DEGREE || node.id === focus || (lit?.has(node.id) ?? false)

            return (
              <g
                key={node.id}
                className="graph-node"
                data-type={node.note.type}
                data-dim={isDim}
                data-selected={node.id === selected}
                transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
                tabIndex={0}
                role="button"
                aria-label={`${node.note.title}, ${node.note.type}, ${node.degree} links`}
                onPointerDown={event => onPointerDown(event, node.id)}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover(h => (h === node.id ? null : h))}
                onFocus={() => setHover(node.id)}
                onBlur={() => setHover(null)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(node.id)
                  }
                }}
              >
                <circle r={r} />
                {showLabel && (
                  <text className="graph-label" y={r + 11} textAnchor="middle" fontSize={10 / Math.max(view.k, 0.8)}>
                    {node.note.title}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {hover && byId.get(hover) && (
        <p className="graph-hover" role="status">
          <strong>{byId.get(hover)!.note.title}</strong>
          {byId.get(hover)!.note.hook && <> {byId.get(hover)!.note.hook}</>}
        </p>
      )}
      <div className="graph-foot">
        <span className="graph-legend">
          {(['project', 'feedback', 'user', 'reference'] as const).map(type => (
            <span key={type} className="graph-key" data-type={type}>
              <svg width="10" height="10" aria-hidden>
                <circle cx="5" cy="5" r="5" />
              </svg>
              {type[0]!.toUpperCase() + type.slice(1)} {notes.filter(n => n.type === type).length}
            </span>
          ))}
        </span>
        <span className="graph-hint">
          Size grows with links. Scroll to zoom, drag to move.{' '}
          <button
            type="button"
            className="ghost graph-fit"
            onClick={() => {
              touched.current = false
              fit()
            }}
          >
            Fit to view
          </button>
        </span>
      </div>
    </div>
  )
}
