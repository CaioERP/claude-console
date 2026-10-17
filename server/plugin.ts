import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import type { Plugin } from 'vite'

import { config, newSessionPrompt } from './config'
import { REPO, getSnapshot, isWorktreePath, refreshKnowledge, refreshSummary, renameSession, setFavorite, removeDormantWorktree, runningSessions, sessionCost, workingAgents } from './collect'
import { isWindowAction, openExternally, openTerminal, startSession, windowAction } from './open'
import { endSession } from './end'
import { readBattery } from './system'
import { diskUsage, refreshDiskFree } from './disk'
import { currentPet, petOptions, petSettings, readPetFile, savePetSettings } from './pets'

const ORIGINS = new Set(['http://127.0.0.1:5178', 'http://localhost:5178'])
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// The latest request to show a session, from the status line's link through the
// launcher; open pages pick it up on their next live poll.
let focus: { session: string; at: number } | null = null

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''

    req.on('data', chunk => {
      body += chunk

      if (body.length > 8_192) req.destroy()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

const isFromConsole = (req: IncomingMessage) => {
  const origin = req.headers.origin ?? ''

  return req.method === 'POST' && req.headers['x-claude-console'] === '1' && (!origin || ORIGINS.has(origin))
}

// Opens a link in the default browser, or a folder in a new Ghostty tab. Only
// the console's own page may ask: the request must come from its origin and
// carry the console's header.
const handleTerminal = async (req: IncomingMessage, res: ServerResponse) => {
  if (!isFromConsole(req)) {
    res.statusCode = 403
    res.end()
    return
  }

  try {
    const { dir, session } = JSON.parse(await readBody(req)) as { dir?: string; session?: string }
    await openTerminal(String(dir ?? ''), session ? String(session) : '')
    res.statusCode = 204
    res.end()
  } catch (error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: String(error) }))
  }
}

const handleRemoveWorktree = async (req: IncomingMessage, res: ServerResponse) => {
  if (!isFromConsole(req)) {
    res.statusCode = 403
    res.end()
    return
  }

  try {
    const { path, force } = JSON.parse(await readBody(req)) as { path?: string; force?: boolean }
    await removeDormantWorktree(String(path ?? ''), force === true)
    res.statusCode = 204
    res.end()
  } catch (error) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    const message = error instanceof Error ? error.message : String(error)

    // Only git's own refusal over modified or untracked files may be forced.
    res.end(JSON.stringify({ error: message, canForce: /modified or untracked files|use --force/i.test(message) }))
  }
}

const handleFocus = async (req: IncomingMessage, res: ServerResponse) => {
  if (!isFromConsole(req)) {
    res.statusCode = 403
    res.end()
    return
  }

  try {
    const { session } = JSON.parse(await readBody(req)) as { session?: string }

    if (!session || !SESSION_ID.test(session)) throw new Error('Not a session id.')

    focus = { session, at: Date.now() }
    res.statusCode = 204
    res.end()
  } catch (error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: String(error) }))
  }
}

const handleOpen = async (req: IncomingMessage, res: ServerResponse) => {
  if (!isFromConsole(req)) {
    res.statusCode = 403
    res.end()
    return
  }

  try {
    const { url } = JSON.parse(await readBody(req)) as { url?: string }
    await openExternally(String(url ?? ''))
    res.statusCode = 204
    res.end()
  } catch (error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: String(error) }))
  }
}

const ICON_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

// The configured brand icon, read from this machine so it never has to live in
// the repository.
const handleIcon = async (res: ServerResponse) => {
  const type = ICON_TYPES[extname(config.brand.icon).toLowerCase()]

  try {
    if (!config.brand.icon || !type) throw new Error('No icon')

    const body = await readFile(config.brand.icon)
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'no-cache')
    // An SVG served from here must never run script.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end()
  }
}

const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/api/brand-icon') return handleIcon(res)

  if (url.pathname === '/api/session/new') {
    if (!isFromConsole(req)) {
      res.statusCode = 403
      res.end()
      return
    }

    try {
      const { dir, input, env } = JSON.parse(await readBody(req)) as { dir?: string; input?: string; env?: string }

      // Given a worktree, an empty session in it; otherwise the configured one in
      // the repository.
      if (dir) {
        if (!(await isWorktreePath(String(dir)))) throw new Error('Not a worktree of this repository.')

        await startSession(String(dir))
      } else {
        await startSession(REPO, newSessionPrompt(config, String(input ?? '').trim(), String(env ?? '')))
      }

      res.statusCode = 204
      res.end()
    } catch (error) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  if (url.pathname === '/api/knowledge/refresh') {
    if (!isFromConsole(req)) {
      res.statusCode = 403
      res.end()
      return
    }

    await refreshKnowledge().catch(() => undefined)
    res.statusCode = 204
    res.end()
    return
  }

  if (url.pathname === '/api/briefing/regenerate') {
    if (!isFromConsole(req)) {
      res.statusCode = 403
      res.end()
      return
    }

    refreshSummary({ force: true })
    res.statusCode = 202
    res.end()
    return
  }

  if (url.pathname === '/api/session/name') {
    if (!isFromConsole(req)) {
      res.statusCode = 403
      res.end()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    try {
      const { session, name } = JSON.parse(await readBody(req)) as { session?: string; name?: string }

      if (!session || !SESSION_ID.test(session)) throw new Error('Not a session id.')

      res.end(JSON.stringify({ names: await renameSession(session, String(name ?? '')) }))
    } catch (error) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  if (url.pathname === '/api/favorites') {
    if (!isFromConsole(req)) {
      res.statusCode = 403
      res.end()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    try {
      const { session, isFavorite } = JSON.parse(await readBody(req)) as { session?: string; isFavorite?: boolean }

      if (!session || !SESSION_ID.test(session)) throw new Error('Not a session id.')

      res.end(JSON.stringify({ favorites: await setFavorite(session, isFavorite !== false) }))
    } catch (error) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  if (url.pathname === '/api/session/end') {
    if (!isFromConsole(req)) {
      res.statusCode = 403
      res.end()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    try {
      const { session } = JSON.parse(await readBody(req)) as { session?: string }

      if (!session || !SESSION_ID.test(session)) throw new Error('Not a session id.')

      res.end(JSON.stringify(await endSession(session)))
    } catch (error) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  if (url.pathname === '/api/pet-settings') {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')

    if (req.method === 'POST') {
      if (!isFromConsole(req)) {
        res.statusCode = 403
        res.end()
        return
      }

      try {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>
        const settings = await savePetSettings({
          ...(typeof body.isEnabled === 'boolean' ? { isEnabled: body.isEnabled } : {}),
          ...(typeof body.kind === 'string' ? { kind: body.kind } : {}),
          ...(typeof body.color === 'string' ? { color: body.color } : {}),
          ...(typeof body.size === 'number' ? { size: body.size } : {}),
        })

        res.end(JSON.stringify({ settings, pet: await currentPet() }))
      } catch (error) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
      return
    }

    res.end(JSON.stringify({ settings: await petSettings(), options: await petOptions() }))
    return
  }

  if (url.pathname.startsWith('/api/pet/')) {
    const data = await readPetFile(decodeURIComponent(url.pathname.slice('/api/pet/'.length)))

    if (!data) {
      res.statusCode = 404
      res.end()
      return
    }

    res.setHeader('Content-Type', 'image/gif')
    res.setHeader('Cache-Control', 'max-age=86400')
    res.end(data)
    return
  }

  if (url.pathname === '/api/system') {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    await refreshDiskFree(REPO)
    res.end(JSON.stringify({ battery: await readBattery(), disk: diskUsage(), pet: await currentPet() }))
    return
  }

  const windowPath = /^\/api\/window\/([a-z]+)$/.exec(url.pathname)

  if (windowPath && isWindowAction(windowPath[1]!)) {
    if (!isFromConsole(req)) {
      res.statusCode = 403
      res.end()
      return
    }

    try {
      await windowAction(windowPath[1])
      res.statusCode = 204
      res.end()
    } catch (error) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  if (url.pathname === '/api/open') return handleOpen(req, res)

  if (url.pathname === '/api/terminal') return handleTerminal(req, res)

  if (url.pathname === '/api/worktree/remove') return handleRemoveWorktree(req, res)

  if (url.pathname === '/api/focus') return handleFocus(req, res)

  if (url.pathname === '/api/live') {
    const running = (await runningSessions()) ?? new Map()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    const entries = await Promise.all(
      [...running].map(async ([id, r]) => [
        id,
        {
          status: r.status,
          since: r.since,
          agents: await workingAgents(id, r.cwd).catch(() => 0),
          cost: await sessionCost(id),
        },
      ]),
    )
    res.end(JSON.stringify({ sessions: Object.fromEntries(entries), focus }))
    return
  }

  if (url.pathname !== '/api/snapshot') return next()

  try {
    const snapshot = await getSnapshot({ force: url.searchParams.has('force') })
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(snapshot))
  } catch (error) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: String(error) }))
  }
}

export const consoleApi = (): Plugin => ({
  name: 'claude-console-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) => void handle(req, res, next))
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => void handle(req, res, next))
  },
})
