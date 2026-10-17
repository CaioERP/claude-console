# Claude Console

A local dashboard for a day of work with Claude Code: the worktrees of one git repository, your open pull requests and their CI, the Claude Code sessions running now, Claude usage and rate limits, and a morning briefing of what you did yesterday. Optional integrations add Jira tickets, a reviewer's merge queue, and the environment each worktree's dev server points at.

Everything runs on your machine. The console reads your local Claude Code files, `git`, and `gh`, and serves a page on `http://127.0.0.1:5178` that only your machine can reach.

## Requirements

- **Linux** with a systemd user session. The console reads `/proc` and `ss`, so macOS and Windows are not supported.
- **Node.js 20 or later** and npm.
- **git**, **jq**, **curl**, and **ss** (from iproute2).
- **GitHub CLI** (`gh`), signed in: `gh auth status` must succeed.
- **Claude Code**, with its data in `~/.claude`.
- Optional: a Chromium-based browser (Chrome, Chromium, Brave, or Edge) to open the console in its own app window; `xdotool` and `wmctrl` to size, focus, maximize, and close that window; [Ghostty](https://ghostty.org) for the buttons that open a worktree or resume a session in a new terminal tab.

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
| `newSession` | `{ prompt, inputLabel, description, environments }`: what the **+** beside the session search starts, after a confirmation window that shows `description`, the folder and the command. `environments` is a list of `{ label, value }` the window offers as buttons (plus **None**); the chosen `value` replaces `{env}` in `prompt`, and **None** leaves it empty. The input may also be a GitHub pull request link, which the pull requests' **+** fills in. It opens a new Claude Code session in the repository, in a new Ghostty tab, with `prompt` as its first message, such as a skill: `"/setup-faro-worktree {input}"`. When `prompt` holds `{input}`, the **+** first asks for it under `inputLabel`; only letters, numbers, `.`, `-` and `_` are accepted. Without it, the **+** starts an empty session. |
| `briefing` | `{ model, language, maxBudgetUsd }`: turns on the written briefing. `model` is any Claude Code model name (default `haiku`), `language` the language it writes in (default English), and `maxBudgetUsd` a hard cap per run (default `0.1`). |
| `reviewQueue` | `{ repo, reviewer, name, mergedPattern, branchSuffix }`: a reviewer's queue that your pull requests are sent to. A pull request is yours when you wrote it, or, with `branchSuffix` (like `-sender-{login}`), when its branch ends with your GitHub login. A comment by `reviewer` that matches `mergedPattern` counts as merged; any other comment by the reviewer counts as rejected, and the last one becomes the reason. |

## Written Briefing

With `briefing` in the configuration, the server runs Claude Code headlessly to write the briefing:

```bash
claude -p "/daily-briefing" --model haiku --tools "" --no-session-persistence --setting-sources project --max-budget-usd 0.1 --output-format json
```

- **The instructions** are the `daily-briefing` skill in this repository, `.claude/skills/daily-briefing/SKILL.md`, which is why it runs from the console's folder. To tune it without editing the repository, put extra instructions in `~/.config/claude-console/daily-briefing.md`; they are added to every run.
- **The input** goes in on standard input: the last working day's sessions with their recaps, the pull requests that moved since yesterday or are still open, the review queue, and the tickets in progress.
- **Isolation.** No tools, no saved session (it never shows up among your sessions), and only the console's own settings, so your hooks and plugins stay out of it; without that, a personal hook can end up quoted in the summary. It uses your Claude Code login, so it counts toward your plan. (`--bare` would isolate even more, but it never reads the Claude Code login and needs an API key.)
- **When it runs.** Once a day, the first time the console has read the day's data, and again when that data changed, at most every half hour. **Regenerate** writes a new one right away. A day's summary is kept in `~/.config/claude-console/briefing/`, so reopening the window shows it without a new run. After a failure it waits ten minutes before trying again on its own, and the lists show instead.
- **Cost.** About US$ 0.003 to 0.015 a run on Haiku.

## What It Shows

The console has two pages, **Dashboard** and **Claude Knowledge** (how your Claude Code is set up: memory, instructions, hooks, skills, MCP servers, extensions, and published artifacts); it remembers the one you left open.

- **Activity.** A contribution heatmap that combines GitHub contributions with Claude tool calls.
- **Briefing.** A greeting with your GitHub photo and bio, then what you did on your last working day, every pull request you opened, merged, or closed since yesterday, and the tickets in progress. With `briefing` configured, Claude writes it as a short summary (a headline, a few sentences, and what comes next) with pull requests and tickets linked, and the lists move behind **Show details**. See [Written Briefing](#written-briefing).
- **Claude sessions.** Running and recent sessions with their worktree, branch, context use, cost, recap, and linked pull requests, read from `~/.claude/sessions`, `~/.claude/projects`, and the status line's snapshots. In a session:
  - **Click the title to rename it.** Enter or a click outside keeps the name, Escape drops it, and an empty name goes back to the one Claude Code knows. The name shows only in the console: Claude Code keeps the name `/rename` gave it, which the console also reads from the transcript.
  - **Add to favorites** in its menu stars it. Starred sessions show a yellow star and stay in the **Favorites** tab after they leave the recent ones, so you can still resume them; click the star to remove it.
  - **End Session** in its menu, for a running session, stops Claude Code and closes its Ghostty tab, after asking. The conversation stays on disk to resume later, and the tab stays open when something else, such as a dev server, still runs in it.
- **Claude usage.** The 5-hour and 7-day rate-limit windows, today's tokens and cost, and a 14-day chart.
- **Jira tickets.** Your open tickets, linked to their worktree, pull request, and running sessions. A ticket without a worktree has a **+** that starts the `newSession` command with its key filled in.
- **Memory and artifacts.** On **Claude Knowledge**: the Claude Code memory notes of the watched repository, and the Artifacts your sessions published.
- **New sessions.** The **+** beside the session search starts a Claude Code session in a new Ghostty tab (see `newSession`), and **Start session here** in a worktree's menu starts an empty one in that worktree.
- **Pull requests.** Below the worktrees: **Mine**, your open pull requests on GitHub, and **Assigned to me**, others' pull requests assigned to you or asking for your review. Each shows CI state, review decision, size, and failing checks. A pull request of the watched repository (or a fork of it) without a worktree has a **+** that starts the `newSession` command with its link filled in.
- **Claude setup.** On **Claude Knowledge**:
  - **Instructions:** the `CLAUDE.md` files and rules, yours and the repository's, each with its first paragraph; click one to read it all.
  - **Hooks:** the hooks in your settings and the repository's, with their event, matcher, and command.
  - **MCP servers:** every server Claude Code would load from the repository, with the health `claude mcp list` reports (connected, needs authentication, failed, and why). It connects to each server, so it runs every ten minutes, or on **Check again**.
  - **Extensions:** marketplace and local plugins, slash commands, and subagents.
- **Skills.** On **Claude Knowledge**: your skills in `~/.claude/skills` (**Mine**) and the ones the watched repository ships in `.claude/skills` (**Project**), each with its command, arguments, description, and how often you used it in the last 40 days (by typing it or by Claude calling it); sort by name or by use. Clicking a command copies it.
- **Window bar.** The console's name, what the worktrees take on disk (measured in the background every half hour at the lowest priority, with the largest ones and the disk's free space in its tooltip, red when the disk is almost full), the laptop's battery (read from `/sys/class/power_supply`, hidden without one), the time, and buttons that maximize or restore the console's app window and close it (through `wmctrl`; in a plain browser tab, maximize switches to full screen).
- **Worktrees.** The five most recently touched, with **Show more** for the rest, grouped as active, idle, or dormant, with a 14-day activity strip from each worktree's reflog, the dev server port, and its environment. Dormant worktrees can be removed from the console, after asking; `git worktree remove` runs without force first, so uncommitted work is never lost by accident. When git refuses because of modified or untracked files, **Force delete** removes it anyway, after a warning that those files are lost; the branch and its commits stay.

## What It Stores

Everything the console keeps stays on this machine, outside the repository:

| Where | What |
|---|---|
| `~/.config/claude-console/config.json` | Your configuration. |
| `~/.config/claude-console/env` (mode 600) | The Jira credentials, when Jira is on. |
| `~/.config/claude-console/favorites.json` (mode 600) | The starred sessions: each one's id, name, branch, and folders, enough to list and resume it later. |
| `~/.config/claude-console/names.json` (mode 600) | The names you gave sessions in the console, by session id. |
| `~/.config/claude-console/disk.json` (mode 600) | The last measure of the worktrees' sizes, so a restart shows it without measuring again. |
| `~/.config/claude-console/briefing/` (mode 600) | The written briefings of the last 14 days, one file per day. |
| The page's browser storage | View preferences: the theme, the selected sessions tab, the Jira view, and the activity tab. |
| `~/.local/share/claude-console/chrome` | The browser profile of the console's app window. |

It never writes to `~/.claude` or to Claude Code's transcripts. To reset favorites or names, delete their file; the console treats a missing file as empty.

## Privacy

The console reads `~/.claude`, the watched repository, and the GitHub and Jira APIs with your credentials. With the written briefing on, the day's session titles, recaps, pull requests, and ticket summaries are sent to Claude through Claude Code, as in any session. The page is served only on `127.0.0.1`. Requests that change something (opening a link or a terminal, starting or ending a session, removing a worktree, starring or renaming a session) must come from the console's own page. The page loads its fonts from Google Fonts.

## Uninstall

```bash
desktop/uninstall.sh
```

This removes the service, launcher, menu entries, and link handler. It keeps what the console stores (see [What It Stores](#what-it-stores)); delete `~/.config/claude-console` and `~/.local/share/claude-console` to remove that too.

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
