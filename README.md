# Claude Console

A local dashboard for a day of work with Claude Code: the worktrees of one git repository, your open pull requests and their CI, the Claude Code sessions running now, Claude usage and rate limits, and a morning briefing of what you did yesterday. Optional integrations add Jira tickets, a reviewer's merge queue, and the environment each worktree's dev server points at.

Everything runs on your machine. The console reads your local Claude Code files, `git`, and `gh`, and serves a page on `http://127.0.0.1:5178` that only your machine can reach.

## Requirements

- **Linux** with a systemd user session. The console reads `/proc` and `ss`, so macOS and Windows are not supported.
- **Node.js 20 or later** and npm.
- **git**, **jq**, **curl**, and **ss** (from iproute2).
- **GitHub CLI** (`gh`), signed in: `gh auth status` must succeed.
- **Claude Code**, with its data in `~/.claude`.
- Optional: a Chromium-based browser (Chrome, Chromium, Brave, or Edge) to open the console in its own app window; `xdotool` and `wmctrl` to size and focus that window; [Ghostty](https://ghostty.org) for the buttons that open a worktree or resume a session in a new terminal tab.

## Install

```bash
git clone <this repository> claude-console
cd claude-console
desktop/install.sh            # add --autostart to open the window at login
```

The installer checks the tools above and installs the npm dependencies. It creates `~/.config/claude-console/config.json` from `config.example.json` and `~/.config/claude-console/env` from `env.example` (mode 600), keeping either file when it already exists. Then it installs and starts the `claude-console` systemd user service, the `claude-console` launcher in `~/.local/bin`, a menu entry, and the `claudeconsole://` link handler.

Then finish the setup:

1. **Point the console at a repository.** Set `"repo"` in `~/.config/claude-console/config.json` to the git repository whose worktrees you want to see. See [Configuration](#configuration).
2. **Install the status line.** It tells the console which sessions are running, where, and how much context, rate limit, and money each one has used. See [Status Line](#status-line).
3. **Restart the service** to pick up the configuration: `systemctl --user restart claude-console.service`.
4. **Open the console** with `claude-console`, or go to `http://127.0.0.1:5178`.

### Installing With Claude Code

Open Claude Code in the cloned folder and ask it to install the console. It should follow these steps:

1. Run `desktop/install.sh` and fix any missing requirement it reports. Never install system packages without asking.
2. Ask which git repository the console should watch, and write it to `"repo"` in `~/.config/claude-console/config.json`.
3. Ask whether to enable the optional integrations (Jira, review queue, dev environments, brand icon) and fill in `config.json` from [Configuration](#configuration). Never write credentials into the repository. The Jira token goes only in `~/.config/claude-console/env`, which stays at mode 600, and the person types it there themselves.
4. Install the status line (see [Status Line](#status-line)). When `~/.claude/settings.json` already has a `statusLine`, keep it by setting `CLAUDE_CONSOLE_NEXT_STATUSLINE`, and show the change before saving it.
5. Run `systemctl --user restart claude-console.service`, wait until `curl -sf http://127.0.0.1:5178/api/snapshot` succeeds, and check that the snapshot's `errors` object is empty.

## Status Line

Claude Code passes each session's state only to its status line command, so the console needs `statusline/console-statusline.sh` to save that state where it can read it (`~/.claude/fleet/<session>.json`). Add this to `~/.claude/settings.json`, using the absolute path of your clone:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/path/to/claude-console/statusline/console-statusline.sh"
  }
}
```

The script prints the session name and an **Open in console** link, which shows the session in the console. To keep a status line you already have, let the script call it: it passes the same input on and prints that command's output instead.

```json
{
  "env": { "CLAUDE_CONSOLE_NEXT_STATUSLINE": "~/.claude/my-statusline.sh" },
  "statusLine": { "type": "command", "command": "/path/to/claude-console/statusline/console-statusline.sh" }
}
```

Without the status line, running sessions still appear, but without their context use, rate limits, and cost.

## Configuration

The console reads `~/.config/claude-console/config.json`, or the file named by `CONSOLE_CONFIG`. Every integration is off until its section is filled in. `examples/liferay.config.json` shows a complete setup.

| Key | What It Does |
|---|---|
| `repo` | The git repository whose worktrees are listed. `CONSOLE_REPO` overrides it. Required. |
| `brand.title` | The name in the header and the window title. |
| `brand.icon` | An SVG, PNG, ICO, WebP, or JPEG on this machine, shown before the title. Keep it outside the repository. |
| `devServer.process` | Text in a listening process's command line that marks it as a worktree's dev server. Default `webpack`. |
| `devEnv` | `{ files, key, rules }`: the env files (relative to each worktree) that hold the URL its dev server talks to, the variable that holds it, and `{ match, name }` rules that name the environment by host, such as `{ "match": "-stg.", "name": "STG" }`. |
| `jira` | `{ site, jql }`: your Jira Cloud site, like `https://example.atlassian.net`, and optionally the search. The default search is your open tickets. Requires `JIRA_API_USER` and `JIRA_API_TOKEN` in `~/.config/claude-console/env`. |
| `reviewQueue` | `{ repo, reviewer, name, mergedPattern, branchSuffix }`: a reviewer's queue that your pull requests are sent to. A pull request is yours when you wrote it, or, with `branchSuffix` (like `-sender-{login}`), when its branch ends with your GitHub login. A comment by `reviewer` that matches `mergedPattern` counts as merged; any other comment by the reviewer counts as rejected, and the last one becomes the reason. |

## What It Shows

- **Activity.** A contribution heatmap that combines GitHub contributions with Claude tool calls.
- **Briefing.** What you did on your last working day, one line per Claude session with its recap, every pull request you opened, merged, or closed since yesterday, and the tickets in progress.
- **Claude sessions.** Running and recent sessions with their worktree, branch, context use, cost, recap, and linked pull requests, read from `~/.claude/sessions`, `~/.claude/projects`, and the status line's snapshots.
- **Claude usage.** The 5-hour and 7-day rate-limit windows, today's tokens and cost, and a 14-day chart.
- **Memory and artifacts.** The Claude Code memory notes of the watched repository, and the Artifacts your sessions published.
- **Pull requests.** Your open pull requests on GitHub, with CI state, review decision, size, and failing checks.
- **Worktrees.** Grouped as active, idle, or dormant, with a 14-day activity strip from each worktree's reflog, the dev server port, and its environment. Dormant worktrees can be removed from the console; `git worktree remove` runs without force, so uncommitted work is never lost.

## Privacy

The console stores nothing of its own beyond its configuration. It reads `~/.claude`, the watched repository, and the GitHub and Jira APIs with your credentials, and it serves the page only on `127.0.0.1`. Requests that change something (opening a link, opening a terminal, removing a worktree) must come from the console's own page. The page loads its fonts from Google Fonts.

## Uninstall

```bash
desktop/uninstall.sh
```

This removes the service, launcher, menu entries, and link handler. It keeps your configuration in `~/.config/claude-console`.

## Develop

```bash
npm install
npm run dev          # http://127.0.0.1:5178 with hot reload; stop the service first
npm test
npm run typecheck
```

There is no separate backend: a Vite plugin (`server/plugin.ts`) answers `/api/*` from the collectors in `server/`. Pages poll every 10 seconds and reload themselves when the service restarts with a new build.

## License

[MIT](LICENSE)
