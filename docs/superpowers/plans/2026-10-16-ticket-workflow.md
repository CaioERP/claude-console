# Ticket Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start Work on a Jira ticket (worktrees and a briefed Claude session), a per-ticket view of everything linked to it, and a Services panel for Docker Compose stacks.

**Architecture:** New server modules (`server/exec.ts`, `server/startwork.ts`, `server/tickets.ts`, `server/services.ts`) hold pure planning and parsing functions, which are unit-tested, plus thin executors that shell out to `git`, `gh` and `docker`. New endpoints go in `server/plugin.ts`. New UI lives in new files (`src/StartWork.tsx`, `src/TicketView.tsx`, `src/Services.tsx`, `src/tickets.ts`), and `src/App.tsx` only gets wiring.

**Tech Stack:** Node 20+, TypeScript, Vite 5 plugin server, React 18, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-10-16-ticket-workflow-design.md`

## Global Constraints

- Work on `main` of the fork `CaioERP/claude-console` at `~/dev/projects/claude-console`, not in a worktree.
- Code stays generic: no Liferay names, remotes or branch names in code, tests or examples. Test data is fictional (`ABC-1`, `octocat`, `example.com`, `/home/dev/...`).
- Every state-changing endpoint checks `isFromConsole(req)` and returns 403 otherwise.
- The page never sends a filesystem path for Start Work or Services. Repositories are named by their configured `name`, and stacks by their `name`.
- Ticket keys must match `^[A-Z][A-Z0-9]*-\d+$`.
- Git: never `--force`, never delete, never reset. New branches use `--no-track`.
- Prefer new files. Edits to upstream files (`App.tsx`, `plugin.ts`, `collect.ts`, `config.ts`, `types.ts`) are small and additive.
- Commit messages are an imperative sentence in the repository's style (for example, "Add the Services panel"). The author is Caio Pinheiro, and there is **no** `Co-Authored-By` line.
- After each task, run `npm test` and `npm run typecheck`, and both must pass.
- Personal config (`~/.config/claude-console/config.json`) and skills (`~/.claude/skills/`) are never committed.

## Review Focus

1. **Both repositories picked, one fetch fails** (offline remote, no access). Expected: that repository reports its error and creates nothing, and the other repository still gets its worktree and session. The test is in Task 3.
2. **The worktree folder exists but isn't a worktree of the repository** (a leftover folder). Expected: blocked with a reason, and nothing is touched. The test is in Task 2.
3. **The page sends a lowercase or padded key, or a key with shell characters** (`abc-1`, ` ABC-1`, `ABC-1;rm`). Expected: 400 with a message, and no git or terminal process. The test is in Task 2.
4. **One GitHub repository in the PR search fails** (no access, rate limit). Expected: the view names that repository and shows the PRs from the rest. The test is in Task 5.
5. **The Docker daemon is down or `docker` is missing.** Expected: the Services panel says so, Start/Stop are disabled, and `snapshot.errors` stays clean. The test is in Task 7.

---

### Task 1: Configuration for Repositories, Start Work and Services

**Files:**
- Modify: `server/config.ts`, `shared/types.ts`
- Test: `server/config.test.ts`

**Interfaces:**
- Produces, in `server/config.ts`:
  - `export type RepoConfig = { path: string; name: string; base: { remote: string; branch: string } | null; worktreesDir: string; prRepos: string[] | null }`
  - `export type ServiceConfig = { name: string; file: string }` (`file` is absolute)
  - `ConsoleConfig` gains `repoConfigs: RepoConfig[]`, `startWork: { prompt: string } | null` and `services: ServiceConfig[]`. `repos: string[]` stays and equals `repoConfigs.map(r => r.path)`.
- Produces, in `shared/types.ts`: `ConsoleFeatures` gains `startWork: { repos: string[] } | null` (the names of repositories with a `base`) and `services: boolean`.

- [ ] **Step 1: Write the failing tests** in `server/config.test.ts`:

```ts
it('reads repository objects with their Start Work settings', () => {
  const c = resolveConfig({ repo: [
    '/home/dev/plain',
    { path: '/home/dev/app', name: 'App', base: { remote: 'upstream', branch: 'main' } },
  ] as never }, {})
  expect(c.repos).toEqual(['/home/dev/plain', '/home/dev/app'])
  expect(c.repoConfigs[0]).toEqual({ path: '/home/dev/plain', name: 'plain', base: null, worktreesDir: '/home/dev/plain-worktrees', prRepos: null })
  expect(c.repoConfigs[1]).toMatchObject({ name: 'App', base: { remote: 'upstream', branch: 'main' }, worktreesDir: '/home/dev/app-worktrees' })
})

it('offers Start Work only for repositories with a base, and only when configured', () => {
  const values = { repo: ['/home/dev/a', { path: '/home/dev/b', name: 'B', base: { remote: 'u', branch: 'm' } }], startWork: { prompt: '/start {key}' } } as never
  expect(featuresOf(resolveConfig(values, {})).startWork).toEqual({ repos: ['B'] })
  expect(featuresOf(resolveConfig({ repo: '/home/dev/a' }, {})).startWork).toBeNull()
})

it('resolves services and drops entries without a name or file', () => {
  const c = resolveConfig({ services: [{ name: 'Tests', file: '/home/dev/a/compose.yml' }, { name: '', file: '/x' }] } as never, {})
  expect(c.services).toEqual([{ name: 'Tests', file: '/home/dev/a/compose.yml' }])
  expect(featuresOf(c).services).toBe(true)
})
```

Also update the existing `featuresOf` expectation to include `startWork: null, services: false`.

- [ ] **Step 2: Run** `npx vitest run server/config.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `repo` and `repos` entries may be a string or `{ path, name?, base?, worktreesDir?, prRepos? }`. Expand `~/` in `path`, `worktreesDir` and `services[].file`. Deduplicate by resolved path, keeping the first. `CONSOLE_REPO` still yields plain entries.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Configure repositories, Start Work and Services".

### Task 2: Plan a Ticket's Worktree

**Files:**
- Create: `server/exec.ts` (move `run` and `quiet` out of `server/collect.ts`, export them, and import them back in `collect.ts`)
- Create: `server/startwork.ts`
- Test: `server/startwork.test.ts`

**Interfaces:**
- Produces, in `server/exec.ts`: `export const run(cmd: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<string>` and `export const quiet<T>(p: Promise<T>, fallback: T): Promise<T>`, with unchanged behavior.
- Produces, in `server/startwork.ts`:
  - `export const isTicketKey(value: string): boolean`
  - `export type RepoState = { worktrees: { path: string; branch: string }[]; localBranches: string[]; forkBranches: string[]; dirExists: boolean }` (`forkBranches` lists the branch names under `origin/`)
  - `export type WorktreePlan = { kind: 'reuse'; path: string } | { kind: 'create'; path: string; from: 'branch' | 'fork' | 'base'; commands: string[][] } | { kind: 'blocked'; reason: string }`. `commands` are argv arrays, each starting with `'git'`.
  - `export const planWorktree(key: string, repo: RepoConfig, state: RepoState): WorktreePlan`

- [ ] **Step 1: Write the failing tests:**

```ts
const repo = { path: '/home/dev/app', name: 'App', base: { remote: 'upstream', branch: 'main' }, worktreesDir: '/home/dev/app-worktrees', prRepos: null }
const empty = { worktrees: [{ path: '/home/dev/app', branch: 'main' }], localBranches: ['main'], forkBranches: [], dirExists: false }

it('accepts only plain ticket keys', () => {
  expect(isTicketKey('ABC-1')).toBe(true)
  for (const bad of ['abc-1', ' ABC-1', 'ABC-1;rm', 'ABC', '-1', 'ABC-1\n']) expect(isTicketKey(bad)).toBe(false)
})
it('reuses a checkout already on the branch, wherever it is', () => {
  const state = { ...empty, worktrees: [{ path: '/home/dev/app', branch: 'ABC-1' }], localBranches: ['ABC-1'] }
  expect(planWorktree('ABC-1', repo, state)).toEqual({ kind: 'reuse', path: '/home/dev/app' })
})
it('checks out an existing local branch without resetting it', () => {
  expect(planWorktree('ABC-1', repo, { ...empty, localBranches: ['main', 'ABC-1'] })).toEqual({
    kind: 'create', path: '/home/dev/app-worktrees/ABC-1', from: 'branch',
    commands: [['git', '-C', '/home/dev/app', 'worktree', 'add', '/home/dev/app-worktrees/ABC-1', 'ABC-1']],
  })
})
it('continues pushed work from the fork', () => {
  expect(planWorktree('ABC-1', repo, { ...empty, forkBranches: ['ABC-1'] })).toMatchObject({
    from: 'fork', commands: [['git', '-C', '/home/dev/app', 'worktree', 'add', '--no-track', '-b', 'ABC-1', '/home/dev/app-worktrees/ABC-1', 'origin/ABC-1']],
  })
})
it('branches fresh from the base, fetching it first', () => {
  expect(planWorktree('ABC-1', repo, empty)).toMatchObject({
    from: 'base', commands: [
      ['git', '-C', '/home/dev/app', 'fetch', 'upstream', 'main'],
      ['git', '-C', '/home/dev/app', 'worktree', 'add', '--no-track', '-b', 'ABC-1', '/home/dev/app-worktrees/ABC-1', 'upstream/main'],
    ],
  })
})
it('refuses a folder that exists but is not a worktree', () => {
  expect(planWorktree('ABC-1', repo, { ...empty, dirExists: true }).kind).toBe('blocked')
})
it('refuses a repository without a base', () => {
  expect(planWorktree('ABC-1', { ...repo, base: null }, empty).kind).toBe('blocked')
})
```

- [ ] **Step 2: Run** `npx vitest run server/startwork.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `isTicketKey` and `planWorktree`, checking the cases in this order: reuse → blocked (folder exists) → branch → fork → base. Blocked when there is no base. Move `run` and `quiet` into `exec.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Plan the worktree a ticket starts in".

### Task 3: Run Start Work on the Server

**Files:**
- Modify: `server/startwork.ts`, `server/plugin.ts`, `server/open.ts` (export nothing new; `startSession` is reused as is)
- Test: `server/startwork.test.ts`

**Interfaces:**
- Consumes: `planWorktree`, `isTicketKey`, `RepoConfig`, `run`, `quiet`, `startSession(dir, prompt)`, `config.startWork`, `config.repoConfigs`.
- Produces:
  - `export const readRepoState(repo: RepoConfig, key: string): Promise<RepoState>`, using `git worktree list --porcelain` (via `parseWorktreePorcelain`), `git branch --list <key> --format=%(refname:short)`, `git branch -r --list origin/<key>`, and `stat` on `<worktreesDir>/<key>`.
  - `export type StartResult = { repo: string; path: string; plan: WorktreePlan['kind'] | 'just-start'; ok: boolean; error?: string }`
  - `export const executeStart(key: string, repos: RepoConfig[], deps: { readState: typeof readRepoState; run: (argv: string[]) => Promise<unknown>; open: (dir: string, prompt: string) => Promise<void>; prompt: string }): Promise<StartResult[]>`. Repositories run in parallel and each one's failure is isolated. A session opens only for repositories that end with `ok: true`.
  - `export const startPrompt(template: string, key: string): string`, which replaces every `{key}`.
  - Endpoints, all guarded by `isFromConsole`, return JSON, and answer 400 with `{ error }` on a bad key, an unknown repository name, or `startWork` not configured:
    - `POST /api/ticket/plan` takes `{ key, repos: string[] }` and returns `{ plans: { repo: string; plan: WorktreePlan }[] }` with no changes made.
    - `POST /api/ticket/start` takes `{ key, repos: string[] }` and returns `{ results: StartResult[] }`.
    - `POST /api/ticket/just-start` takes `{ key, repo: string }`, opens a session in that repository's main checkout with the prompt, and returns `{ results: StartResult[] }`.

- [ ] **Step 1: Write the failing tests** with fake deps:

```ts
it('isolates a failing fetch to its repository', async () => {
  const a = { ...repo, name: 'A', path: '/home/dev/a', worktreesDir: '/home/dev/a-worktrees' }
  const b = { ...repo, name: 'B', path: '/home/dev/b', worktreesDir: '/home/dev/b-worktrees' }
  const opened: string[] = []
  const results = await executeStart('ABC-1', [a, b], {
    readState: async () => empty,
    run: async argv => { if (argv.includes('/home/dev/a') && argv.includes('fetch')) throw new Error('offline') },
    open: async dir => { opened.push(dir) },
    prompt: '/start-ticket ABC-1',
  })
  expect(results.map(r => [r.repo, r.ok])).toEqual([['A', false], ['B', true]])
  expect(results[0]!.error).toContain('offline')
  expect(opened).toEqual(['/home/dev/b-worktrees/ABC-1'])
})
it('opens a session in a reused checkout without running git', async () => { /* plan reuse → run never called, open called with that path */ })
it('fills the key into the prompt', () => expect(startPrompt('/start-ticket {key} now', 'ABC-1')).toBe('/start-ticket ABC-1 now'))
```

- [ ] **Step 2: Run** `npx vitest run server/startwork.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `readRepoState`, `executeStart`, `startPrompt` and the three endpoints. Each endpoint calls `refreshWorktrees` (or the snapshot force path) after a successful start, so the page updates.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS. Then run a dry check against the dev server with a key that has no branch: `curl -s -X POST -H 'X-Claude-Console: 1' -H 'Content-Type: application/json' -d '{"key":"ABC-1","repos":["<a configured name>"]}' http://127.0.0.1:5178/api/ticket/plan`. Expected: a `create` plan with `from: "base"`.
- [ ] **Step 5: Commit:** "Start work on a ticket from the server".

### Task 4: Start Work Button and Picker

**Files:**
- Create: `src/StartWork.tsx`
- Modify: `src/App.tsx` (export `Modal` and `askConfirm`; in `JiraTickets`, render `<StartWorkButton>` in place of `setupFor` when `features.startWork` is set, keeping upstream's button otherwise)
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: the `/api/ticket/plan`, `/api/ticket/start` and `/api/ticket/just-start` endpoints from Task 3, `features.startWork`, and `Modal` / `askConfirm` from `src/App.tsx`.
- Produces: `export const StartWorkButton: (props: { issueKey: string; repos: string[]; isSmall?: boolean }) => JSX.Element`.

- [ ] **Step 1: Implement the picker modal.** Show one button per name in `repos`, then **Both** (only when there are 2 or more names), then **Just start**. Just start asks for the repository as a second step, with the same buttons and no Both.
- [ ] **Step 2: Implement the confirmation.** After a choice, call `/api/ticket/plan` and show each repository's plan in the modal: its folder, its exact commands (each argv joined with spaces, in `<code>`), and "Reuses <path>" or "Blocked: <reason>". Disable Confirm when every plan is blocked. On Confirm, call `/api/ticket/start`, then show a notice listing each result (opened / error).
- [ ] **Step 3: Verify by hand** in `npm run dev`: on a ticket with no worktree, the picker opens and the plan modal lists `git fetch` and `git worktree add --no-track -b`. Cancel leaves nothing behind (`git worktree list` is unchanged).
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Pick repositories and start work from a ticket".

### Task 5: Ticket Data (Description and PR Chain)

**Files:**
- Create: `server/tickets.ts`
- Modify: `server/jira.ts` (add the description fetch), `server/plugin.ts`, `shared/types.ts`
- Test: `server/tickets.test.ts`, `server/jira.test.ts`

**Interfaces:**
- Produces, in `shared/types.ts`:
  - `TicketPr = { repo: string; number: number; title: string; url: string; branch: string; author: string; state: 'open' | 'merged' | 'closed'; createdAt: number; ci: CiState }` (`ci` is `'none'` unless the PR is open)
  - `TicketDetail = { key: string; description: string; prs: TicketPr[]; prErrors: { repo: string; error: string }[] }`
- Produces, in `server/tickets.ts`:
  - `export const gitHubRepoOf(remoteUrl: string): string | null` turns `git@github.com:o/r.git` or `https://github.com/o/r(.git)` into `'o/r'`, and returns null for non-GitHub URLs.
  - `export const prReposFor(repos: RepoConfig[], remotesByPath: Map<string, string[]>, queueRepo: string | null): string[]` returns `prRepos` when set, otherwise every remote's GitHub repository, plus `queueRepo`, deduplicated.
  - `export const mergePrChain(key: string, lists: { repo: string; prs?: RawListedPr[]; error?: string }[]): Pick<TicketDetail, 'prs' | 'prErrors'>`. It keeps PRs whose title or branch `mentions` the key (import `mentions` from `src/format.ts`), deduplicates by `url`, and sorts by `createdAt` ascending.
  - `export const ticketDetail(key: string): Promise<TicketDetail>`, which runs `gh pr list -R <repo> --state all --search <key> --limit 50 --json number,title,url,headRefName,author,state,createdAt,statusCheckRollup` for each repository in parallel, caches the result for 3 minutes per key, and includes the description.
- Produces, in `server/jira.ts`:
  - `export const adfToText(node: unknown): string`, which handles paragraphs and headings (separated by a blank line), list items (prefixed with `- `), `hardBreak`, and `text`.
  - `export const fetchDescription(jira, key: string): Promise<string>`, which calls `GET /rest/api/3/issue/<key>?fields=description` with the same `curl --config -` pattern.
- Endpoint: `GET /api/ticket?key=<KEY>` returns `TicketDetail`. A bad key gets 400. A key that isn't in `snapshot.jira` gets 404 with `{ error: 'Not in your Jira list' }`.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(gitHubRepoOf('git@github.com:octocat/app.git')).toBe('octocat/app')
expect(gitHubRepoOf('https://github.com/octocat/app')).toBe('octocat/app')
expect(gitHubRepoOf('https://example.com/x/y.git')).toBeNull()

it('orders the chain oldest first, dedupes, and keeps going past a failing repository', () => {
  const pr = (repo: string, n: number, at: string, title = `ABC-1 Work ${n}`) =>
    ({ number: n, title, url: `https://github.com/${repo}/pull/${n}`, headRefName: 'ABC-1', author: { login: 'octocat' }, state: 'MERGED', createdAt: at, statusCheckRollup: [] })
  const out = mergePrChain('ABC-1', [
    { repo: 'octocat/app', prs: [pr('octocat/app', 2, '2026-01-02T00:00:00Z'), pr('octocat/app', 2, '2026-01-02T00:00:00Z')] },
    { repo: 'org/app', prs: [pr('org/app', 9, '2026-01-01T00:00:00Z'), pr('org/app', 10, '2026-01-03T00:00:00Z', 'ABC-10 Other')] },
    { repo: 'rev/app', error: 'HTTP 403' },
  ])
  expect(out.prs.map(p => p.url)).toEqual(['https://github.com/org/app/pull/9', 'https://github.com/octocat/app/pull/2'])
  expect(out.prErrors).toEqual([{ repo: 'rev/app', error: 'HTTP 403' }])
})

expect(adfToText({ type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Do it' }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
] })).toBe('Do it\n\n- one')
```

- [ ] **Step 2: Run** `npx vitest run server/tickets.test.ts server/jira.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions and the endpoint. Map gh `state` to lowercase, and compute `ci` with `ciOf(toChecks(...))` from `server/pure.ts` for open PRs only.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS. Then `curl -s 'http://127.0.0.1:5178/api/ticket?key=<a key in your list>' | jq '.prs | length, .prErrors'` returns PRs and an empty or explained error list.
- [ ] **Step 5: Commit:** "Gather a ticket's description and pull request chain".

### Task 6: Ticket View and Back-Links

**Files:**
- Create: `src/TicketView.tsx`, `src/tickets.ts`
- Modify: `src/App.tsx` (routing, links from tickets, chips on worktree and session rows), `src/styles.css`
- Test: `src/format.test.ts` (or a new `src/tickets.test.ts`)

**Interfaces:**
- Consumes: `GET /api/ticket`, `TicketDetail`, `StartWorkButton`, `mentions`.
- Produces:
  - in `src/tickets.ts`: `export const keyIn(text: string, keys: string[]): string | null` (the first key that `text` mentions); `export const ticketHref(key: string): string` (`?ticket=<key>`); `export const useTicketParam(): [string | null, (key: string | null) => void]`, which uses `pushState` and `popstate`; `export const TicketKeys = createContext<string[]>([])`.
  - in `src/TicketView.tsx`: `export const TicketView: (props: { issue: JiraIssue | undefined; key: string; snapshot: Snapshot; renderWorktree: (w: Worktree) => ReactNode; renderSession: (s: Session) => ReactNode; onBack: () => void }) => JSX.Element`.

- [ ] **Step 1: Write the failing tests** for `keyIn`:

```ts
expect(keyIn('feature/ABC-10-x', ['ABC-1', 'ABC-10'])).toBe('ABC-10')
expect(keyIn('ABC-1', ['XABC-1'])).toBeNull()
expect(ticketHref('ABC-1')).toBe('?ticket=ABC-1')
```

- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** `src/tickets.ts`, then `TicketView`:
  - When `issue` is undefined, show "Not in your Jira list" with a link to `<site>/browse/<key>` and nothing else.
  - Otherwise show: the header (key, summary, status, type, priority, parent link, Jira link); the description (`white-space: pre-wrap`, with "Loading…" and error states); worktrees grouped by `repoName`, where a worktree matches when `mentions(branch or name, key)`, rendered with `renderWorktree`; a `StartWorkButton` for repositories with no match; PRs (repo, #number, title, author, state, CI) oldest first, with `prErrors` listed under them; and sessions matched by `mentions(branch, key)`, rendered with `renderSession`.
- [ ] **Step 4: Wire `App.tsx`.**
  - When `useTicketParam()` returns a key, render `TicketView` in place of the grid, and the back link clears the key.
  - In `JiraTickets`, the ticket key and summary become links that set the key.
  - Wrap the grid in `<TicketKeys.Provider value={snapshot.jira.map(i => i.key)}>`.
  - `WorktreeRow` and the session row render a small `.tag` chip (`<TicketChip text={branch} />`, defined in `src/TicketView.tsx`) that opens the view when `keyIn` finds a key.
  - Pass `renderWorktree={w => <WorktreeRow worktree={w} now={now} />}` and the session row equivalent.
- [ ] **Step 5: Verify by hand:** clicking a ticket opens `?ticket=KEY` with its worktrees, PRs (closed ones too) and sessions. The browser Back button returns to the grid. `?ticket=ZZZ-1` shows "Not in your Jira list".
- [ ] **Step 6: Run** `npm test && npm run typecheck`, then **commit:** "Show everything linked to a ticket in its own view".

### Task 7: Services Backend

**Files:**
- Create: `server/services.ts`
- Modify: `server/plugin.ts`, `shared/types.ts`
- Test: `server/services.test.ts`

**Interfaces:**
- Produces, in `shared/types.ts`:
  - `ServiceContainer = { name: string; state: string; ports: string; startedAt: number | null }`
  - `ServiceStack = { name: string; state: 'up' | 'partial' | 'down'; project: string; workingDir: string; isOwnCheckout: boolean; containers: ServiceContainer[]; upSince: number | null }`
  - `ServicesStatus = { available: boolean; reason: string; stacks: ServiceStack[] }`
- Produces, in `server/services.ts`:
  - `export const parseDockerPs(text: string): RawContainer[]` parses the JSON lines from `docker ps -a --no-trunc --format '{{json .}}'`, reading `Names`, `State`, `Ports`, `CreatedAt` and the `Labels` string (`k=v,k=v`). `RawContainer = { name, state, ports, createdAt, labels: Record<string, string> }`.
  - `export const stackOf(service: ServiceConfig, repos: RepoConfig[], containers: RawContainer[]): ServiceStack`. A container belongs to the stack when its `com.docker.compose.project.config_files` label ends with the service file's path relative to the repository that contains it, and starts with that repository's `path` or `worktreesDir`. When the file is outside every repository, match on the file's base name inside the same folder. Choose the project with the most running containers. `isOwnCheckout` means the `working_dir` label equals the configured file's folder. `upSince` is the oldest `startedAt` among running containers (use `docker inspect` `.State.StartedAt` only if `CreatedAt` is not good enough; `CreatedAt` is acceptable).
  - `export const servicesStatus(): Promise<ServicesStatus>`. When `docker` fails, return `{ available: false, reason: <first stderr line>, stacks: [] }` and never throw.
  - `export const startStack(name: string)` runs `docker compose -f <file> up -d` with `cwd` set to the file's folder, and refuses when another checkout's project is running (`!isOwnCheckout && state !== 'down'`).
  - `export const stopStack(name: string)` runs `docker compose -p <project> down` for the running project.
- Endpoints: `GET /api/services`; `POST /api/services/start` and `/api/services/stop` with `{ name }`, guarded, returning 400 for an unknown name.

- [ ] **Step 1: Write the failing tests:**

```ts
const line = (name: string, state: string, files: string, wd: string) => JSON.stringify({
  Names: name, State: state, Ports: '0.0.0.0:5433->5432/tcp', CreatedAt: '2026-01-01 10:00:00 +0000 UTC',
  Labels: `com.docker.compose.project=p,com.docker.compose.project.config_files=${files},com.docker.compose.project.working_dir=${wd}`,
})
const repos = [{ path: '/home/dev/app', name: 'App', base: null, worktreesDir: '/home/dev/app-worktrees', prRepos: null }]
const service = { name: 'Tests', file: '/home/dev/app/compose.test.yml' }

it('finds the stack when a worktree started it', () => {
  const containers = parseDockerPs(line('db', 'running', '/home/dev/app-worktrees/ABC-1/compose.test.yml', '/home/dev/app-worktrees/ABC-1'))
  const stack = stackOf(service, repos, containers)
  expect(stack).toMatchObject({ state: 'up', isOwnCheckout: false, workingDir: '/home/dev/app-worktrees/ABC-1' })
})
it('ignores the same file name from another repository', () => {
  expect(stackOf(service, repos, parseDockerPs(line('db', 'running', '/home/dev/other/compose.test.yml', '/home/dev/other'))).state).toBe('down')
})
it('reports partial when only some containers run', () => { /* one running, one exited → 'partial' */ })
```

Also add a test for `servicesStatus` with an injected failing runner, expecting `available: false` and no throw. To make that possible, have `servicesStatus` accept an optional `run` parameter that defaults to `exec.run`.

- [ ] **Step 2: Run** `npx vitest run server/services.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and the endpoints.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS. Then `curl -s http://127.0.0.1:5178/api/services | jq` lists the configured stacks.
- [ ] **Step 5: Commit:** "Read and control Docker Compose stacks".

### Task 8: Services Panel

**Files:**
- Create: `src/Services.tsx`
- Modify: `src/App.tsx` (render `<ServicesPanel sessions={snapshot.sessions} />` at the top of the right column when `features.services` is set), `src/styles.css`

**Interfaces:**
- Consumes: the Task 7 endpoints and types, `askConfirm` and `showNotice` (export `showNotice` too).
- Produces: `export const ServicesPanel: (props: { sessions: Session[] }) => JSX.Element`, and `export const needsReminder(stack: ServiceStack, sessions: Session[], now: number): boolean`, which is true when the stack isn't `'down'`, `now - upSince > 2 * 60 * 60 * 1000`, and no session `isRunning`.

- [ ] **Step 1: Write the failing test** for `needsReminder`: up for 3 h with no running session → true; up for 3 h with one running session → false; up for 1 h → false; down → false.
- [ ] **Step 2: Implement** the panel:
  - Poll `/api/services` every 10 s.
  - Show one block per stack: its state, its containers (name, state, ports), the checkout that started it (base name of `workingDir`), and the reminder line when `needsReminder`.
  - **Start** is disabled when the stack isn't down, or when another checkout holds it (with a title saying which). **Stop** asks for confirmation, naming the project and folder, and is disabled when the stack is down.
  - When `available` is false, show the reason and disable both buttons.
- [ ] **Step 3: Verify by hand:** Start the integration stack from the panel, see it go `up` (`docker ps` agrees), then Stop it and confirm it goes `down`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then **commit:** "Add the Services panel".

### Task 9: The `/start-ticket` Skill, Docs and Live Config

**Files:**
- Create (outside the repository, not committed): `~/.claude/skills/start-ticket/SKILL.md`
- Modify: `README.md` (the `repo` object form, `startWork`, `services`, the ticket view), `config.example.json` (`"startWork": null, "services": []`)
- Modify (personal, not committed): `~/.config/claude-console/config.json`, to the shape in the spec's Configuration section, with the two real repositories, `startWork.prompt` `"/start-ticket {key}"`, and the two compose files.

- [ ] **Step 1: Write the skill.** Frontmatter: `name: start-ticket`, and a `description` saying it reads a Jira ticket and writes a brief before any work starts, used with `/start-ticket <KEY>`. Body:
  1. Validate the key.
  2. Read the ticket with the Atlassian connector: description, acceptance criteria, comments, parent, linked issues, subtasks. If the connector needs a sign-in, say so and ask the person to sign in or paste the ticket.
  3. Explore the current repository for the code involved.
  4. Write the brief under the headings **What needs to be done**, **Likely files**, and **Open questions**.
  5. Stop and wait for directions: no edits, no commits.
- [ ] **Step 2: Update the README and the example config**, then run `npm test && npm run typecheck`.
- [ ] **Step 3: End-to-end check.** Restart the dev server. In the console, open a ticket in your list and run Start Work → one repository. Expected: a worktree at `<worktreesDir>/<KEY>` on branch `<KEY>`, `git -C <worktree> rev-parse --abbrev-ref @{u}` fails (no upstream), and a Terminator tab running `/start-ticket <KEY>` that ends with the brief.
- [ ] **Step 4: Commit** the README and the example: "Document Start Work, the ticket view and Services". Then push `main` to `origin`.
