import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Skill } from '../shared/types'
import { parseSkill } from './pure'

// The skills in one folder: each subfolder holding a SKILL.md, following
// symbolic links. Anything else, such as a folder of synced skills, is skipped.
const skillsIn = async (dir: string, source: Skill['source']): Promise<Skill[]> => {
  const entries = await readdir(dir).catch(() => [] as string[])
  const skills = await Promise.all(
    entries.map(async entry => {
      const path = join(dir, entry, 'SKILL.md')

      try {
        const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
        const skill = parseSkill(text)

        return {
          name: skill.name || entry,
          description: skill.description,
          argumentHint: skill.argumentHint,
          source,
          path,
          updatedAt: info.mtimeMs,
        } satisfies Skill
      } catch {
        return null
      }
    }),
  )

  return skills.filter((s): s is Skill => s !== null).sort((a, b) => a.name.localeCompare(b.name))
}

// Your personal skills, and those the watched repository ships.
export const collectSkills = async (repo: string): Promise<Skill[]> => {
  const [mine, project] = await Promise.all([
    skillsIn(join(homedir(), '.claude', 'skills'), 'personal'),
    repo ? skillsIn(join(repo, '.claude', 'skills'), 'project') : Promise.resolve([]),
  ])

  return [...mine, ...project]
}
