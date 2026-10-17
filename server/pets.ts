import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Pet, PetOptions, PetSettings } from '../shared/types'
import { CONFIG_DIR } from './config'

// The pets of the vscode-pets extension, whose art comes from the artists
// credited below. Their sprites ship inside the extension's published package,
// which is fetched once from the Visual Studio Marketplace; only the GIFs of
// the actions used here are kept, on this machine. This repository never ships
// them.
const PACKAGE_URL =
  'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/tonybaloney/vsextensions/vscode-pets/latest/vspackage'
const DIR = join(CONFIG_DIR, 'pets')
const MAX_BYTES = 2 * 1024 * 1024
const ACTIONS = ['walk', 'idle', 'lie', 'run', 'with_ball'] as const

const COMPLETE = join(DIR, '.complete')
const KIND = /^[a-z][a-z-]*$/

export const SIZE = { min: 16, max: 80, default: 30 }

const ARTISTS: Record<string, string> = {
  cat: 'seethingswarm',
  dog: 'NVPH Studio',
  fox: 'Elthen',
  panda: 'Jessie Ferris',
  clippy: 'Marc Duiker',
  rocky: 'Marc Duiker',
  zappy: 'Marc Duiker',
  'rubber-duck': 'Marc Duiker',
  snake: 'Marc Duiker',
  cockatiel: 'Marc Duiker',
  crab: 'Marc Duiker',
  mod: 'Marc Duiker',
  horse: 'Chris Kent, from art by Onfe',
  snail: 'Kennet Shin',
  skeleton: 'Chris Kent, from art by MonoPixelArt',
}

export const PET_FILE = /^([a-z-]+)\/([a-z]+_(?:walk|idle|lie|run|with_ball)_8fps\.gif)$/

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]!

const credit = (kind: string) => `${kind.replace(/-/g, ' ')} from vscode-pets${ARTISTS[kind] ? `, art by ${ARTISTS[kind]}` : ''}`

const isGif = (data: Buffer) => data.length > 6 && data.subarray(0, 4).toString('latin1') === 'GIF8'

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile(cmd, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, error => (error ? reject(error) : resolve())),
  )

// The colors a pet comes in, among those with both a walking and an idle sprite.
const colorsOf = (files: string[]) => {
  const colors = new Set(files.map(f => /^([a-z]+)_walk_8fps\.gif$/.exec(f)?.[1]).filter(Boolean) as string[])

  return [...colors].filter(c => files.includes(`${c}_idle_8fps.gif`))
}

const petOf = (kind: string, color: string, files: string[], size: number): Pet => {
  const sprite = (action: string) => (files.includes(`${color}_${action}_8fps.gif`) ? `${kind}/${color}_${action}_8fps.gif` : '')

  return {
    kind,
    color,
    credit: credit(kind),
    walk: sprite('walk'),
    idle: sprite('idle'),
    lie: sprite('lie'),
    run: sprite('run'),
    withBall: sprite('with_ball'),
    size,
  }
}

const filesOf = async (kind: string) => readdir(join(DIR, kind)).catch(() => [] as string[])

// Fetches the extension's package once and keeps every pet's sprites for the
// actions used here, each checked to really be a GIF.
const extract = async () => {
  const response = await fetch(PACKAGE_URL, { signal: AbortSignal.timeout(120_000) })

  if (!response.ok) throw new Error(`The Marketplace answered ${response.status}.`)

  const data = Buffer.from(await response.arrayBuffer())

  if (data.subarray(0, 2).toString('latin1') !== 'PK') throw new Error('The Marketplace did not send the package.')

  const staging = join(DIR, '.staging')
  const archive = join(DIR, '.vscode-pets.vsix')

  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true, mode: 0o700 })
  await writeFile(archive, data, { mode: 0o600 })

  try {
    await run('unzip', ['-q', '-o', archive, 'extension/media/*/*_8fps.gif', '-d', staging])

    const media = join(staging, 'extension', 'media')

    for (const kind of (await readdir(media).catch(() => [] as string[])).filter(k => KIND.test(k))) {
      const from = join(media, kind)
      const files = (await readdir(from).catch(() => [] as string[])).filter(f =>
        ACTIONS.some(action => f.endsWith(`_${action}_8fps.gif`)),
      )

      await mkdir(join(DIR, kind), { recursive: true, mode: 0o700 })

      for (const file of files) {
        const sprite = await readFile(join(from, file))

        if (isGif(sprite) && sprite.length <= MAX_BYTES) await rename(join(from, file), join(DIR, kind, file))
      }
    }
    await writeFile(COMPLETE, `${new Date().toISOString()}\n`, { mode: 0o600 })
  } finally {
    await rm(staging, { recursive: true, force: true })
    await rm(archive, { force: true })
  }
}

// The pets fetched so far: every folder with at least one usable color.
const kindsFetched = async () => {
  const kinds = (await readdir(DIR).catch(() => [] as string[])).filter(k => KIND.test(k)).sort()
  const usable = await Promise.all(kinds.map(async kind => (colorsOf(await filesOf(kind)).length ? kind : '')))

  return usable.filter(Boolean)
}

const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')
// Off until turned on, so nothing is fetched for someone who never wants a pet.
const DEFAULTS: PetSettings = { isEnabled: false, kind: '', color: '', size: SIZE.default }

let ready: Promise<void> | null = null

// The sprites are fetched once, the first time they are needed.
const ensureSprites = () =>
  (ready ??= (async () => {
    const isComplete = await readFile(COMPLETE).then(() => true, () => false)

    if (!isComplete) await extract().catch(() => undefined)
  })())

const readSettings = async (): Promise<Record<string, unknown>> => {
  try {
    return JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export const petSettings = async (): Promise<PetSettings> => ({ ...DEFAULTS, ...((await readSettings()).pet as Partial<PetSettings>) })

// The pets and the colors each comes in, as fetched.
export const petOptions = async (): Promise<PetOptions> => {
  await ensureSprites()

  const options: PetOptions = {}

  for (const kind of await kindsFetched()) options[kind] = colorsOf(await filesOf(kind)).sort()

  return options
}

// The pet the settings ask for: off, or a pet and color, each fixed or drawn
// at random when left empty. A fixed color the pet lacks is drawn instead.
const choose = async (settings: PetSettings): Promise<Pet | null> => {
  if (!settings.isEnabled) return null

  const options = await petOptions()
  const kinds = Object.keys(options)
  const kind = kinds.includes(settings.kind) ? settings.kind : kinds.length ? pick(kinds) : ''

  if (!kind) return null

  const colors = options[kind]!
  const color = colors.includes(settings.color) ? settings.color : pick(colors)

  return petOf(kind, color, await filesOf(kind), settings.size)
}

let chosen: Promise<Pet | null> | null = null

// The pet for this start of the console, drawn on the first ask so a build
// never waits on the network, and drawn again when the settings change.
export const currentPet = () => (chosen ??= petSettings().then(choose))

export const savePetSettings = async (next: Partial<PetSettings>) => {
  const options = await petOptions()
  const current = await petSettings()
  const kind = typeof next.kind === 'string' ? next.kind : current.kind
  const color = typeof next.color === 'string' ? next.color : current.color
  const size = typeof next.size === 'number' && Number.isFinite(next.size) ? next.size : current.size
  const isKnown = Object.hasOwn(options, kind)
  const settings: PetSettings = {
    isEnabled: typeof next.isEnabled === 'boolean' ? next.isEnabled : current.isEnabled,
    kind: isKnown ? kind : '',
    // A color only means something for a chosen pet that comes in it.
    color: isKnown && options[kind]!.includes(color) ? color : '',
    size: Math.round(Math.min(SIZE.max, Math.max(SIZE.min, size))),
  }

  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await writeFile(`${SETTINGS_FILE}.tmp`, `${JSON.stringify({ ...(await readSettings()), pet: settings }, null, 2)}\n`, { mode: 0o600 })
  await rename(`${SETTINGS_FILE}.tmp`, SETTINGS_FILE)
  chosen = choose(settings)

  return settings
}

export const readPetFile = async (path: string) => {
  const match = PET_FILE.exec(path)

  if (!match || !KIND.test(match[1]!)) return null

  const data = await readFile(join(DIR, match[1]!, match[2]!)).catch(() => null)

  return data && isGif(data) ? data : null
}
