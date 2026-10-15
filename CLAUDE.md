# Claude Console

A local dashboard (Vite + React + TypeScript) whose API is a Vite plugin in `server/`. Read `README.md` first.

- To install the console for someone, follow "Installing with Claude Code" in `README.md`.
- Personal settings live in `~/.config/claude-console/config.json` and secrets in `~/.config/claude-console/env`. Never write either one, or any token, path, or name from them, into this repository.
- After changing code, run `npm test` and `npm run typecheck`, then `systemctl --user restart claude-console.service` to deploy.
- Test data must be fictional: example.com hosts, `ABC-1` tickets, `octocat`, zeroed session ids.
