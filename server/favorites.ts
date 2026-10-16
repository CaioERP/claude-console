import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { FavoriteSession } from '../shared/types'
import { CONFIG_DIR } from './config'

const FILE = join(CONFIG_DIR, 'favorites.json')

// The sessions you starred, kept on this machine so they outlast the one day
// the status line keeps a session's snapshot.
export const readFavorites = async (): Promise<FavoriteSession[]> => {
  try {
    const data = JSON.parse(await readFile(FILE, 'utf8')) as { sessions?: FavoriteSession[] }

    return Array.isArray(data.sessions) ? data.sessions : []
  } catch {
    return []
  }
}

const writeFavorites = async (sessions: FavoriteSession[]) => {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await writeFile(`${FILE}.tmp`, `${JSON.stringify({ sessions }, null, 2)}\n`, { mode: 0o600 })
  await rename(`${FILE}.tmp`, FILE)
}

export const addFavorite = async (favorite: FavoriteSession) => {
  const sessions = (await readFavorites()).filter(s => s.id !== favorite.id)

  await writeFavorites([favorite, ...sessions])
}

export const removeFavorite = async (id: string) => {
  await writeFavorites((await readFavorites()).filter(s => s.id !== id))
}
