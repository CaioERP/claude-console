# Ticket Workflow: Start Work, Ticket View, Services

Status: awaiting approval · 2026-10-16 · fork `CaioERP/claude-console`

## Intent

Picking up a Jira ticket today takes a string of manual steps: read the ticket in Jira, decide which repository it touches, fetch, create a worktree and branch by hand, open a terminal, start Claude, paste the ticket in. Afterwards, the ticket's trail (worktrees in two repositories, a chain of pull requests that get closed as they are forwarded from fork to upstream to the reviewer's queue, Claude sessions) is scattered across the console, GitHub and Jira.

This work makes a ticket the unit of work in the console:

1. **Start Work**: one button on a ticket that creates fresh worktrees in the right repositories and opens a Claude session that reads the ticket and writes a brief, then waits.
2. **Ticket view**: one page per ticket that gathers everything linked to it.
3. **Services**: the Docker Compose stacks you depend on, with their state and Start/Stop.

## Goals

- Start Work on any Jira ticket in the console: pick the repositories, get a worktree per repository on a fresh branch, and get a Claude session that has already read the ticket.
- See a ticket's whole trail in one place, including closed pull requests.
- See whether the integration-test stack is up, and start or stop it without a terminal.
- Keep the code generic. Everything specific to one person or company lives in `~/.config/claude-console/config.json` or in `~/.claude/skills/`, never in the repository.

## Non-Goals

- No writes to Jira (status transitions, comments). Read only.
- No automatic coding. The session stops after the brief and waits for directions.
- No pull request to the original repository (`interaminense/claude-console`) for now. The work lives on the fork.
- The brief is not saved or shown in the console. It exists only in the Claude session.

## Anti-Goals (A Failure Even if It Works)

- Losing work: Start Work must never overwrite, reset or delete an existing branch or folder.
- A new branch that tracks `upstream/...`, so that a bare `git push` targets the shared repository.
- Liferay names, remotes or branch names hard-coded in the console's code.
- Large edits across upstream's files that turn every `git pull --rebase upstream main` into a conflict fight. Prefer new files and new components.

## Constraints

- Builds on what upstream already has and reuses it:
  - `linksOf` / `IssueLinks` in `src/App.tsx` (ticket ↔ worktree, PR, sessions by key)
  - `startSession` in `server/open.ts`, `/api/session/new` in `server/plugin.ts`
  - the confirmation modals (`askConfirm`, `NewSessionButton`)
  - `isFromConsole` for every state-changing endpoint
- The fork already supports several repositories (`config.repos`, `Worktree.repo` / `repoName`) and Terminator (`config.terminal`, `desktop/terminator-tab`, with the same `--new <dir> [prompt]` interface as `ghostty-tab`).
- Linux only, like the rest of the console. Docker is read through the `docker` CLI.
- Tests: Vitest for pure logic (`server/*.test.ts`, `src/format.test.ts`), run with `npm test` and `npm run typecheck`.

## Decisions

### Configuration

`repo` (string or list) keeps working. A list entry can also be an object that adds what Start Work needs:

```json
{
  "repo": [
    {
      "path": "~/dev/projects/com-liferay-osb-asah-private",
      "name": "Asah",
      "base": { "remote": "upstream", "branch": "7.0.x" },
      "worktreesDir": "~/dev/projects/com-liferay-osb-asah-private-worktrees"
    },
    {
      "path": "~/dev/projects/liferay-portal",
      "name": "Faro",
      "base": { "remote": "liferay-ac", "branch": "master" },
      "worktreesDir": "~/dev/projects/liferay-portal-worktrees"
    }
  ],
  "startWork": { "prompt": "/start-ticket {key}" },
  "services": [
    { "name": "Integration tests", "file": "~/dev/projects/com-liferay-osb-asah-private/docker-compose.integration-test.yml" },
    { "name": "Local Faro", "file": "~/dev/projects/com-liferay-osb-asah-private/docker-compose.yml" }
  ]
}
```

- `name` defaults to the folder's base name, and `worktreesDir` defaults to `<path>-worktrees`.
- A repository without `base` can't be picked for Start Work.
- Without `startWork`, there is no Start Work button. Without `services`, there is no Services panel.

### Start Work

- **Where:** on each Jira ticket (board and list, next to the existing `IssueLinks`) and in the ticket view. When `startWork` is configured, it replaces upstream's single "Set up a worktree" button. When it isn't, upstream's button stays as it is.
- **The picker** (a modal, built like upstream's): one option per repository that has a `base` (for example **Asah**, **Faro**), **Both** (every repository with a `base`), and **Just start**. It always asks; it never guesses from the summary prefix.
- **For each chosen repository, the console runs:**
  1. `git -C <path> fetch <remote> <branch>`. If this fails, stop and report; nothing is created.
  2. If branch `<KEY>` is already checked out anywhere (`<worktreesDir>/<KEY>`, another worktree folder, or the main checkout), reuse that checkout and open the session there. The modal says where.
  3. Otherwise, if local branch `<KEY>` exists, run `git worktree add <worktreesDir>/<KEY> <KEY>` (existing branch, no reset).
  4. Otherwise, if `origin/<KEY>` exists on the fork remote (`origin` only, never the base remote), run `git worktree add --no-track -b <KEY> <worktreesDir>/<KEY> origin/<KEY>`, so pushed work is continued rather than replaced.
  5. Otherwise, run `git worktree add --no-track -b <KEY> <worktreesDir>/<KEY> <remote>/<branch>`.
  6. If `<worktreesDir>/<KEY>` exists but is not a worktree of this repository, stop and report.
  7. Never force, never delete, never reset.
- **Session:** after the worktrees exist, open one terminal tab per worktree with `startSession(worktreePath, prompt)`, where `prompt` is `startWork.prompt` with `{key}` filled in. This uses the configured terminal (Terminator here).
- **Just start:** no fetch, no worktree, no branch. It asks which repository, then opens a session in that repository's main checkout with the same prompt. The person then gives the direction, for example a different base branch.
- **Confirmation:** before running, the modal lists the exact commands and folders. One confirm runs everything.
- **Input safety:** the key must match `^[A-Z][A-Z0-9]*-\d+$`. Repositories are chosen by index or name from the config, never by a path sent from the page.
- **Endpoint:** `POST /api/ticket/start` with `{ key, repos: string[] | "just-start", justStartRepo? }`, guarded by `isFromConsole`.

### `/start-ticket` Skill

- Lives in `~/.claude/skills/start-ticket/SKILL.md`, outside the repository.
- Reads the ticket through the Atlassian connector in Claude: description, acceptance criteria, comments, parent epic, linked tickets, subtasks. If the connector is not signed in, it says so and asks the person to sign in or paste the ticket.
- Explores the repository it runs in for the code the ticket touches.
- Writes a brief: what needs to be done, files likely involved, open questions.
- **Stops and waits.** No code, no commits.
- Works anywhere, including a worktree made by hand, so it's useful without the console.

### Ticket View

- **URL:** `/?ticket=<KEY>`, a full-page view with a back link, opened by clicking a ticket's key or summary in the Jira panel. The URL is the state, so it can be bookmarked.
- **Scope:** only tickets in the Jira panel's list (the configured JQL). For any other key, such as an old bookmark or a ticket that has moved to Done, the view shows "Not in your Jira list" with a link to the ticket in Jira, and nothing else.
- **Header:** key, summary, status, type, priority, parent epic (linked), and a link to Jira, all read from the snapshot.
- **Description:** the ticket's description as plain text. The console fetches it through its own Jira API access, on demand, for this one ticket.
- **Worktrees:** every worktree in any repository whose branch or folder name mentions the key, grouped by repository, each with Open in terminal and Start session here. Start Work appears for repositories that don't have one yet.
- **Pull requests:** every PR with the key in its title or branch, **open and closed, whoever opened it**, oldest first, so the chain reads fork → upstream / liferay-ac → reviewer queue. Each shows its repository, author, state (open / merged / closed), CI for open ones, and a link.
  - **Which repositories:** for each configured repository, its GitHub repositories come from its git remotes (`origin`, the `base` remote, and any other remote), plus `reviewQueue.repo`. A new optional `prRepos` list per repository can narrow or extend that.
  - **How:** one `gh pr list -R <repo> --state all --search "<KEY>"` per GitHub repository, run in parallel, deduplicated by URL, fetched on demand when the view opens, and cached for a few minutes. A repository that fails (no access, rate limit) is named in the view, and the rest still shows.
- **Sessions:** every session, running or recent, whose branch mentions the key, with Resume / End Session from upstream's session actions.
- **Back-links:** worktree rows and session rows get a small key chip that opens the ticket view, only when that key is in the Jira list.

### Services Panel

- One block per configured stack. Each container shows its state (running / exited / missing), published ports, and uptime, plus the folder that started it (compose's `working_dir` label).
- A stack counts as up no matter which checkout started it: a worktree's copy of the same compose file is a different compose project but holds the same containers and ports. Find containers with `docker ps -a` by the `com.docker.compose.project.config_files` label, matching the configured file's name relative to its repository, in the main checkout or any of its worktrees.
- **Start:** `docker compose -f <file> up -d` from the configured file. It is disabled while a project from another checkout holds the stack, and the panel names that checkout.
- **Stop:** `docker compose -p <project> down` for the project that is actually running, after a confirmation modal that names the project and its folder.
- **Reminder:** when a stack has been up for more than 2 hours while no Claude session is running, the panel shows a reminder that it's still up.
- **Endpoints:** `POST /api/services/start` and `/api/services/stop` with `{ name }`. The stack is looked up by name in the config, never by a path sent from the page. Guarded by `isFromConsole`.
- If `docker` is missing or the daemon is down, the panel shows that, and the console reports no error elsewhere.

## Left to the Builder

- Component structure, file names for new server modules (for example `server/tickets.ts`, `server/services.ts`), styling, and how the ticket view fits into `App.tsx` routing. Prefer new files.
- Polling and caching intervals for the ticket view's PR search and the Services panel. Follow existing TTL patterns.
- How the description's Atlassian Document Format is turned into plain text.
- Test coverage of the pure parts: config parsing, key validation, the plan of git commands for each worktree state, PR-chain ordering, compose `ps` parsing.

## Calls Made by Claude (Not Discussed)

- `--no-track` on new branches, so nothing tracks the shared remote.
- A branch that is already checked out anywhere is reused where it is, not moved or forced.
- `origin/<KEY>` on the fork counts as existing work and becomes the worktree's starting point.
- Services finds a stack started from any checkout or worktree, and Stop acts on the project that is actually running.
- The GitHub repositories searched for a ticket's PRs come from each repository's git remotes plus the review queue, with an optional `prRepos` override.
- Just start asks for the repository as a second step.
- The 2-hour threshold for the Services reminder.
- The configuration shape (objects in `repo`, `startWork.prompt` with `{key}`, `services` as a list of named compose files).

## Future Skills (Recommended, Not Part of This Work)

- **`/ship-ticket`:** runs the repository's full verification (format, SpotBugs, unit and integration tests, teardown), pushes, and opens the fork PR with a title only.
- **`/forward-pr`:** takes a merged fork PR forward to the next step of the chain (upstream / liferay-ac / reviewer queue).
- **`/close-ticket`:** after merge, stops services, removes the dormant worktrees, and summarizes the ticket's trail.
- **`/ticket-status`:** prints the same aggregate as the ticket view in the terminal.
