import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DiskUsage } from '../shared/types'
import { CONFIG_DIR } from './config'

const FILE = join(CONFIG_DIR, 'disk.json')
const TTL_MS = 30 * 60_000

const run = (cmd: string, args: string[], timeoutMs: number) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error && !stdout ? reject(error) : resolve(String(stdout)),
    ),
  )

let usage: DiskUsage = { worktrees: [], totalBytes: 0, scannedAt: 0, isScanning: false, disk: null }
let loaded = false
let job: Promise<void> | null = null

export const diskUsage = () => usage

// The filesystem the repository lives on: its size, what is used, what is free.
const readDisk = async (repo: string) => {
  const line = (await run('df', ['-B1', '--output=size,used,avail', repo], 10_000)).trim().split('\n').pop() ?? ''
  const [size = 0, used = 0, free = 0] = line.trim().split(/\s+/).map(Number)

  return size > 0 ? { size, used, free } : null
}

// The size of one folder, on its own filesystem, without following symbolic
// links, so a node_modules linked from the main checkout is not counted again.
// It runs at the lowest CPU and disk priority, since the folders are large.
const sizeOf = async (path: string) => {
  const out = await run('nice', ['-n', '19', 'ionice', '-c3', 'du', '-sxb', path], 10 * 60_000).catch(() => '')

  return Number(out.trim().split(/\s+/)[0]) || 0
}

// Measures every worktree but the main checkout, which holds them and would
// count them twice, one at a time and at most every half hour. The last result
// is kept on disk, so a restart shows it at once.
export const refreshDiskUsage = (repo: string, worktrees: string[]) => {
  // The kept result is read first, and the next call decides on a new scan.
  if (!loaded) {
    loaded = true
    job = readFile(FILE, 'utf8')
      .then(text => {
        usage = { ...(JSON.parse(text) as DiskUsage), isScanning: false }
      })
      .catch(() => undefined)
      .finally(() => {
        job = null
      })
    return
  }

  if (job || !repo || (usage.scannedAt && Date.now() - usage.scannedAt < TTL_MS)) return

  job = (async () => {
    usage = { ...usage, isScanning: true }

    const linked = worktrees.filter(path => path !== repo)
    const sizes: DiskUsage['worktrees'] = []

    for (const path of linked) sizes.push({ path, bytes: await sizeOf(path) })

    sizes.sort((a, b) => b.bytes - a.bytes)
    usage = {
      worktrees: sizes,
      totalBytes: sizes.reduce((sum, w) => sum + w.bytes, 0),
      scannedAt: Date.now(),
      isScanning: false,
      disk: await readDisk(repo).catch(() => null),
    }

    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
    await writeFile(`${FILE}.tmp`, `${JSON.stringify({ ...usage, isScanning: false })}\n`, { mode: 0o600 })
    await rename(`${FILE}.tmp`, FILE)
  })()
    .catch(() => {
      usage = { ...usage, isScanning: false }
    })
    .finally(() => {
      job = null
    })
}

// Free space changes faster than worktree sizes; it is cheap to read often.
export const refreshDiskFree = async (repo: string) => {
  if (!repo || !usage.scannedAt) return

  const disk = await readDisk(repo).catch(() => null)

  if (disk) usage = { ...usage, disk }
}
