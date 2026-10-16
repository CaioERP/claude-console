import { execFile } from 'node:child_process'

// Runs a command without a shell and resolves with its output; a failure
// carries the command's stderr.
export const run = (cmd: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: options.cwd, timeout: options.timeoutMs ?? 20_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve(stdout)),
    )
  })

export const quiet = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await promise
  } catch {
    return fallback
  }
}
