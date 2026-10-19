import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CONFIG_DIR } from './config'

const FILE = join(CONFIG_DIR, 'names.json')

export const MAX_NAME = 120

// The names you gave sessions in the console, by session id. They show only in
// the console: Claude Code keeps the name /rename gave it.
export const readNames = async (): Promise<Record<string, string>> => {
  try {
    const data = JSON.parse(await readFile(FILE, 'utf8')) as { sessions?: Record<string, string> }

    return data.sessions && typeof data.sessions === 'object' ? data.sessions : {}
  } catch {
    return {}
  }
}

// A name is one line of text; control characters and runs of spaces collapse.
export const cleanName = (name: string) =>
  name
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)

export const setName = async (id: string, name: string) => {
  const names = await readNames()
  const clean = cleanName(name)

  if (clean) names[id] = clean
  else delete names[id]

  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await writeFile(`${FILE}.tmp`, `${JSON.stringify({ sessions: names }, null, 2)}\n`, { mode: 0o600 })
  await rename(`${FILE}.tmp`, FILE)

  return names
}
