import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import type { PublishedArtifact } from '../shared/types'
import { htmlTitle } from './pure'
import { scannedArtifacts } from './usage'

const titles = new Map<string, string>()

// "cms-theme-svgs.html" reads as "Cms theme svgs".
const readableName = (path: string) => {
  const words = basename(path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()

  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The artifacts Claude published from any session, newest first. A title the
// publish did not name comes from the page's own <title>, or its file name.
export const collectArtifacts = async (): Promise<PublishedArtifact[]> => {
  const list = await Promise.all(
    scannedArtifacts().map(async artifact => {
      let title = artifact.title || titles.get(artifact.url) || ''

      if (!title && artifact.filePath) {
        title = htmlTitle(await readFile(artifact.filePath, 'utf8').catch(() => ''))
        if (title) titles.set(artifact.url, title)
      }

      return {
        url: artifact.url,
        title: title || (artifact.filePath ? readableName(artifact.filePath) : 'Untitled artifact'),
        description: artifact.description,
        version: artifact.version,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        sessionIds: [...artifact.sessionIds],
      }
    }),
  )

  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}
