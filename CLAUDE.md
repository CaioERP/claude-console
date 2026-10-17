# Claude Console

A local dashboard (Vite + React + TypeScript) whose API is a Vite plugin in `server/`. Read `README.md` first.

- To install the console for someone, follow "Installing With Claude Code" in `README.md`.
- Personal settings live in `~/.config/claude-console/config.json` and secrets in `~/.config/claude-console/env`. Never write either one, or any token, path, or name from them, into this repository.
- After changing code, run `npm test` and `npm run typecheck`, then `systemctl --user restart claude-console.service` to deploy.
- Test data must be fictional: example.com hosts, `ABC-1` tickets, `octocat`, zeroed session ids.
- Personal state the console keeps (favorites, names, written briefings) lives in `~/.config/claude-console` too; never move it into the repository or into `~/.claude`.

## UI Conventions

- Hover text goes in `data-tooltip`, never `title`: one `TooltipLayer` shows it in the console's own style, ties it to the element with `aria-describedby`, and the browser's native tooltip never appears.
- Confirmations and notices use `askConfirm` and `showNotice` (the `Modal`), never `window.confirm` or `window.alert`.

## Written Briefing

- The text is written by `server/summary.ts`, which runs `claude -p "/daily-briefing"` from the console's own folder, so the `daily-briefing` skill in `.claude/skills` is what drives it. Change the writing there, not in code.
- Keep the run isolated: `--tools ""`, `--no-session-persistence`, and `--setting-sources project`. Without the last one, the user's own hooks and plugins load and can end up quoted in the summary. Never switch to `--bare`: it skips the Claude Code login and needs an API key.
- The service's PATH lacks `~/.local/bin`, where `claude` usually lives; `findClaude` looks there too.
- The input is built in `server/briefing-input.ts` from stable facts only; anything that changes often (CI state, timestamps) would change the hash and trigger a new paid run.
- In `ensureSummary`, the running flag is cleared in `.finally()` on the promise, never inside the async body: a body that returns before its first await would clear the flag before it is set, and no run would ever start again.
- Every real run costs the user's plan. When testing, prefer the unit tests and one regenerate, not loops.

## Testing Actions

Actions that open Ghostty, end sessions, delete worktrees, or start sessions have real effects. Check them headlessly with Playwright and intercept their routes (`/api/terminal`, `/api/session/*`, `/api/worktree/remove`, `/api/window/*`); test `desktop/ghostty-tab` with `DRY_RUN=1`.
