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

export type LiveStatus = Record<string, { status: string; since: number; agents: number; cost: number | null }>

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

export type Battery = { percent: number; isCharging: boolean; isPluggedIn: boolean }

export type ConsoleFeatures = {
  title: string
  hasIcon: boolean
  jira: boolean
  reviewQueue: { name: string; repo: string } | null
  newSession: { needsInput: boolean; inputLabel: string; prompt: string; description: string }
}

export type ContributionDay = { date: string; github: number; claude: number }

export type Contributions = { days: ContributionDay[]; githubAt: number }

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
  artifacts: PublishedArtifact[]
  profile: Profile | null
  briefing: Briefing | null
  recentPrs: RecentPr[]
  worktreesAt: number
  prsAt: number
  errors: { worktrees?: string; prs?: string; usage?: string; jira?: string; queue?: string; contributions?: string; memory?: string; artifacts?: string; profile?: string }
}
