import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { MemoryNote } from '../shared/types'
import { parseMemoryIndex, parseMemoryNote, projectSlug } from './pure'

// The auto-memory of the repository's own Claude Code project.
export const memoryDir = (repo: string) => join(homedir(), '.claude', 'projects', projectSlug(repo), 'memory')

export const collectMemory = async (repo: string): Promise<MemoryNote[]> => {
  const dir = memoryDir(repo)
  // A repository Claude Code never saved a memory for simply has none.
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[]

    throw error
  })
  const files = entries.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
  const index = parseMemoryIndex(await readFile(join(dir, 'MEMORY.md'), 'utf8').catch(() => ''))

  const notes = await Promise.all(
    files.map(async file => {
      const path = join(dir, file)
      const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      const note = parseMemoryNote(text)
      const listed = index.get(file)

      return {
        file,
        name: note.name || file.replace(/\.md$/, ''),
        title: listed?.title || note.name || file.replace(/\.md$/, ''),
        hook: listed?.hook ?? '',
        description: note.description,
        type: note.type,
        body: note.body,
        updatedAt: info.mtimeMs,
      } satisfies MemoryNote
    }),
  )

  return notes.sort((a, b) => b.updatedAt - a.updatedAt)
}
