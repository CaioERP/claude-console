import { execFile, spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const ALLOWED = /^(https?|ghosttycd):/i
const DESKTOP_VARS = ['DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']

let launchCount = 0

// Starts a desktop program (a terminal, a browser) in a scope of its own, out
// of the console service's cgroup. Started straight from the service, a
// Ghostty or a browser that was not running yet would belong to the service,
// and restarting the console would kill it with every tab and session in it.
// Without systemd-run, it starts as before.
const launchApp = (command: string, args: string[], env: NodeJS.ProcessEnv) => {
  const unit = `app-claude-console-${command.split('/').pop()!.replace(/[^\w-]/g, '')}-${process.pid}-${(launchCount += 1)}`
  const scoped = ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', command, ...args]
  const child = spawn('systemd-run', scoped, { env, detached: true, stdio: 'ignore' })

  child.on('error', () => {
    spawn(command, args, { env, detached: true, stdio: 'ignore' }).unref()
  })
  child.unref()
}

// The graphical session's environment as the user manager holds it now. The
// service may have started at boot, before any session existed, so its own
// environment cannot be trusted to reach the screen.
const desktopEnv = () =>
  new Promise<Record<string, string>>(resolve => {
    execFile('systemctl', ['--user', 'show-environment'], { timeout: 5_000 }, (error, stdout) => {
      const env: Record<string, string> = {}

      if (!error) {
        for (const line of stdout.split('\n')) {
          const at = line.indexOf('=')
          const key = line.slice(0, at)

          if (DESKTOP_VARS.includes(key)) env[key] = line.slice(at + 1)
        }
      }

      resolve(env)
    })
  })

export const isOpenable = (url: string) => ALLOWED.test(url)

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isSessionId = (value: string) => SESSION_ID.test(value)

const GHOSTTY_TAB = join(process.cwd(), 'desktop', 'ghostty-tab')

// Opens a new tab in the main Ghostty window inside dir, resuming the session
// when one is given. The page only names a folder and a session id; the command
// itself is built by the ghostty-tab script, never taken from the request.
export const openTerminal = async (dir: string, session = '', isRemote = false) => {
  if (!isAbsolute(dir) || !(await stat(dir).then(s => s.isDirectory(), () => false))) {
    throw new Error(`Not a directory: ${dir}`)
  }

  if (session && !isSessionId(session)) throw new Error(`Not a session id: ${session}`)

  const env = { ...process.env, ...(await desktopEnv()) }
  launchApp(GHOSTTY_TAB, session ? [dir, session, ...(isRemote ? ['remote'] : [])] : [dir], env)
}

// Opens a new tab in the main Ghostty window inside dir and starts a new Claude
// Code session there, with prompt as its first message when given.
export const startSession = async (dir: string, prompt = '') => {
  if (!isAbsolute(dir) || !(await stat(dir).then(s => s.isDirectory(), () => false))) {
    throw new Error(`Not a directory: ${dir}`)
  }

  const env = { ...process.env, ...(await desktopEnv()) }
  launchApp(GHOSTTY_TAB, ['--new', dir, ...(prompt ? [prompt] : [])], env)
}

// Opens a link with the person's default browser and profile, outside the
// console's own app window.
export const openExternally = async (url: string) => {
  if (!isOpenable(url)) throw new Error('Only http, https and ghosttycd links open from the console.')

  const env = { ...process.env, ...(await desktopEnv()) }
  launchApp('xdg-open', [url], env)
}

const WINDOW_ACTIONS = {
  close: { args: ['-x', '-c', 'ClaudeConsole'], verb: 'close' },
  maximize: { args: ['-x', '-r', 'ClaudeConsole', '-b', 'toggle,maximized_vert,maximized_horz'], verb: 'maximize' },
} as const

export type WindowAction = keyof typeof WINDOW_ACTIONS

export const isWindowAction = (value: string): value is WindowAction => Object.hasOwn(WINDOW_ACTIONS, value)

// Closes the console's own app window, or toggles it between maximized and its
// previous size, through the window manager. The launcher opens that window
// with the ClaudeConsole window class.
export const windowAction = async (action: WindowAction) => {
  const env = { ...process.env, ...(await desktopEnv()) }
  const { args, verb } = WINDOW_ACTIONS[action]

  await new Promise<void>((resolve, reject) => {
    execFile('wmctrl', [...args], { env, timeout: 5_000 }, error =>
      error ? reject(new Error(`Could not ${verb} the window: wmctrl is missing or no console window is open.`)) : resolve(),
    )
  })
}
