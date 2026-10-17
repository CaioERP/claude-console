export type Activity = 'active' | 'idle' | 'dormant'

export type CiState = 'passing' | 'failing' | 'running' | 'none'

export type Session = {
  id: string
  name: string
  isAutoTitle: boolean
  responses: number
  recap: string
  recapAt: number
  prUrls: string[]
  branch: string
  model: string
  top: string
  dir: string
  resumeDir: string
  ctx: number
  h5: number | null
  h5Reset: string
  h5ResetAt: number | null
  d7: number | null
  d7ResetAt: number | null
  cost: number | null
  seenAt: number
  isLive: boolean
  isRunning: boolean
  runStatus: string
  runSince: number
  // Where the session continues on claude.ai, while Remote Control is on.
  remoteUrl: string
  // The name Claude Code knows, when the console shows one you gave it instead.
  claudeName?: string
}

// What is kept of a starred session, enough to list and resume it after its
// snapshot is gone.
export type FavoriteSession = {
  id: string
  name: string
  branch: string
  top: string
  dir: string
  resumeDir: string
  addedAt: number
}

export type LiveStatus = Record<string, { status: string; since: number; agents: number; cost: number | null; remoteUrl: string }>

export type FocusRequest = { session: string; at: number }

export type LiveResponse = { sessions: LiveStatus; focus: FocusRequest | null }

export type Worktree = {
  path: string
  name: string
  branch: string
  isDetached: boolean
  isMain: boolean
  sha: string
  subject: string
  committedAt: number
  lastTouchedAt: number
  activityDays: number[]
  devServerPort: string
  devUrl: string
  devEnv: string
  sessions: Session[]
  activity: Activity
}

export type Check = {
  name: string
  workflow: string
  state: 'success' | 'failure' | 'pending' | 'skipped' | 'neutral'
  url: string
  startedAt: number | null
  completedAt: number | null
}

export type PullRequest = {
  repo: string
  author: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: number
  updatedAt: number
  branch: string
  reviewDecision: string
  mergeState: string
  additions: number
  deletions: number
  checks: Check[]
  ci: CiState
  worktreePath: string
}

export type UsageDay = {
  date: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  responses: number
  byModel: Record<string, number>
}

export type UsageWindow = { percent: number; resetsAt: number | null }

export type Usage = {
  days: UsageDay[]
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  windowsReportedAt: number
  todayCost: number | null
  scannedAt: number
}

export type JiraIssue = {
  key: string
  summary: string
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done' | string
  type: string
  priority: string
  updatedAt: number
  parentKey: string
  parentSummary: string
  url: string
}

export type QueueLabel = { name: string; state: 'success' | 'failure' | 'pending' | 'other' }

export type QueuedPr = {
  number: number
  title: string
  url: string
  ticket: string
  createdAt: number
  closedAt: number | null
  outcome: 'waiting' | 'merged' | 'rejected' | 'closed'
  reason: string
  labels: QueueLabel[]
}

export type ReviewQueue = { name: string; repo: string; waiting: QueuedPr[]; recent: QueuedPr[] }

// What the worktrees take on disk, measured in the background, and how full the
// disk is.
export type DiskUsage = {
  worktrees: Array<{ path: string; bytes: number }>
  totalBytes: number
  scannedAt: number
  isScanning: boolean
  disk: { size: number; used: number; free: number } | null
}

// The pet walking in the window bar: its sprites, as paths under /api/pet/.
export type Pet = {
  kind: string
  color: string
  credit: string
  walk: string
  idle: string
  // Empty when the pet has no sprite for it.
  lie: string
  run: string
  withBall: string
  // The sprite's width in pixels.
  size: number
}

// How the window bar's pet is set: on or off, and a pet and color, each fixed
// or, when empty, drawn at random.
// size is the sprite's width in pixels.
export type PetSettings = { isEnabled: boolean; kind: string; color: string; size: number }

// The pets that can be chosen, with the colors each comes in.
export type PetOptions = Record<string, string[]>

export type Battery = { percent: number; isCharging: boolean; isPluggedIn: boolean }

export type ConsoleFeatures = {
  title: string
  hasIcon: boolean
  jira: boolean
  reviewQueue: { name: string; repo: string } | null
  newSession: {
    needsInput: boolean
    inputLabel: string
    prompt: string
    description: string
    environments: Array<{ label: string; value: string }>
  }
}

export type ContributionDay = { date: string; github: number; claude: number }

export type Contributions = { days: ContributionDay[]; githubAt: number }

export type Skill = {
  name: string
  description: string
  argumentHint: string
  source: 'personal' | 'project'
  path: string
  updatedAt: number
  // Uses in the scanned transcripts, by Claude or by typing the command.
  uses: number
  lastUsedAt: number
}

export type McpServer = { name: string; target: string; status: 'connected' | 'auth' | 'failed'; detail: string }

// A CLAUDE.md or rule file: its first heading and paragraph, and the full text.
export type Instruction = { scope: 'user' | 'project'; path: string; title: string; summary: string; body: string; updatedAt: number }

export type Hook = { scope: 'user' | 'project' | 'local'; event: string; matcher: string; command: string }

export type Extension = {
  kind: 'plugin' | 'local plugin' | 'command' | 'agent'
  scope: 'user' | 'project'
  name: string
  description: string
  isEnabled: boolean
}

export type ClaudeKnowledge = {
  mcp: { servers: McpServer[]; checkedAt: number; error: string }
  instructions: Instruction[]
  hooks: Hook[]
  extensions: Extension[]
}

export type MemoryNote = {
  file: string
  name: string
  title: string
  hook: string
  description: string
  type: string
  body: string
  updatedAt: number
}

export type PublishedArtifact = {
  url: string
  title: string
  description: string
  version: number
  createdAt: number
  updatedAt: number
  sessionIds: string[]
}

export type Profile = {
  login: string
  name: string
  bio: string
  location: string
  avatarUrl: string
  url: string
}

export type DaySession = {
  id: string
  title: string
  worktree: string
  branch: string
  responses: number
  firstAt: number
  lastAt: number
  recap: string
}

// The written summary of the briefing: off when not configured, writing while
// Claude works on it, ready once written, error when the first try failed.
export type BriefingSummary = {
  status: 'off' | 'writing' | 'ready' | 'error'
  text: string
  generatedAt: number
  model: string
  // Why the last run failed, even while an older summary still shows.
  error: string
}

export type Briefing = {
  day: string
  isYesterday: boolean
  sessions: DaySession[]
  todaySessions: number
}

export type RecentPr = {
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'merged' | 'closed'
  createdAt: number
  closedAt: number | null
  updatedAt: number
}

export type Snapshot = {
  build: string
  generatedAt: number
  repo: string
  worktrees: Worktree[]
  prs: PullRequest[]
  sessions: Session[]
  usage: Usage | null
  jira: JiraIssue[]
  jiraAt: number
  queue: ReviewQueue | null
  features: ConsoleFeatures
  // The ids of the starred sessions, newest first, and those no longer among
  // the recent sessions, rebuilt from what was kept.
  favorites: string[]
  favoriteSessions: Session[]
  // The names given in the console, by session id.
  names: Record<string, string>
  contributions: Contributions | null
  memory: MemoryNote[]
  skills: Skill[]
  knowledge: ClaudeKnowledge
  artifacts: PublishedArtifact[]
  profile: Profile | null
  briefing: Briefing | null
  summary: BriefingSummary
  recentPrs: RecentPr[]
  // Open pull requests by others that are assigned to you or ask for your review.
  assignedPrs: PullRequest[]
  worktreesAt: number
  prsAt: number
  errors: { worktrees?: string; prs?: string; usage?: string; jira?: string; queue?: string; contributions?: string; memory?: string; skills?: string; knowledge?: string; artifacts?: string; profile?: string }
}
