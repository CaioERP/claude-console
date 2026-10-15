import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Battery } from '../shared/types'

const POWER = '/sys/class/power_supply'

const read = (path: string) => readFile(path, 'utf8').then(s => s.trim(), () => '')

// The laptop's battery from sysfs, combining several batteries by their
// average charge; null on a machine without one.
export const batteryOf = (
  supplies: Array<{ type: string; capacity: string; status: string; online: string }>,
): Battery | null => {
  const batteries = supplies.filter(s => s.type === 'Battery' && s.capacity !== '')

  if (batteries.length === 0) return null

  const percent = Math.round(batteries.reduce((sum, b) => sum + Number(b.capacity), 0) / batteries.length)
  const statuses = batteries.map(b => b.status.toLowerCase())
  const isPluggedIn = supplies.some(s => s.type === 'Mains' && s.online === '1')

  return {
    percent: Math.max(0, Math.min(100, percent)),
    isCharging: statuses.includes('charging'),
    isPluggedIn: isPluggedIn || statuses.includes('charging') || statuses.includes('full'),
  }
}

export const readBattery = async (): Promise<Battery | null> => {
  const names = await readdir(POWER).catch(() => [] as string[])
  const supplies = await Promise.all(
    names.map(async name => {
      const [type, capacity, status, online] = await Promise.all(
        ['type', 'capacity', 'status', 'online'].map(file => read(join(POWER, name, file))),
      )

      return { type: type!, capacity: capacity!, status: status!, online: online! }
    }),
  )

  return batteryOf(supplies)
}
