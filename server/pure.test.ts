import { describe, expect, it } from 'vitest'

import {
  DAY_MS,
  activityDays,
  ciOf,
  classifyWorktree,
  envOf,
  parseListeners,
  parseReflogTimes,
  isSentBy,
  briefingDay,
  claudeActivity,
  parseSessionRow,
  worktreeNameOf,
  isAgentFinished,
  htmlTitle,
  parseArtifactCalls,
  parseMemoryIndex,
  parseToolResults,
  publishedArtifact,
  parseMemoryNote,
  parsePrLink,
  parseRecapLine,
  parseTitleLine,
  parseToolLine,
  parseUsageLine,
  procStartOf,
  queueLabel,
  queueOutcome,
  projectSlug,
  resumeCandidates,
  ticketOf,
  parseWorktreePorcelain,
  readEnvValue,
  toChecks,
} from './pure'

describe('parseWorktreePorcelain', () => {
  it('reads branches and detached heads', () => {
    const entries = parseWorktreePorcelain(
      [
        'worktree /repo',
        'HEAD aaa',
        'branch refs/heads/master',
        '',
        'worktree /repo/.claude/worktrees/check',
        'HEAD bbb',
        'detached',
        '',
      ].join('\n'),
    )

    expect(entries).toEqual([
      { path: '/repo', head: 'aaa', branch: 'master', isDetached: false },
      { path: '/repo/.claude/worktrees/check', head: 'bbb', branch: '', isDetached: true },
    ])
  })
})

describe('parseListeners', () => {
  it('pairs each port with every owning pid once', () => {
    const out = parseListeners(
      [
        'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
        'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=20),("node",pid=42,fd=21))',
        'LISTEN 0 511 [::]:8080 [::]:* users:(("java",pid=7,fd=1))',
      ].join('\n'),
    )

    expect(out).toEqual([
      { port: '3000', pid: 42 },
      { port: '8080', pid: 7 },
    ])
  })
})

describe('parseReflogTimes', () => {
  it('reads the timestamp of each HEAD move', () => {
    const text =
      'aaa bbb Dev <dev@example.com> 1760472000 -0300\tcommit: ABC-1 Fix\n' +
      'bbb ccc Dev <dev@example.com> 1760475600 -0300\tcheckout: moving from a to b\n'

    expect(parseReflogTimes(text)).toEqual([1760472000000, 1760475600000])
  })
})

describe('classifyWorktree', () => {
  const now = Date.parse('2026-10-14T12:00:00')

  it('is active with a dev server or a live session regardless of age', () => {
    expect(classifyWorktree({ lastTouchedAt: 0, hasDevServer: true, hasLiveSession: false, now })).toBe('active')
    expect(classifyWorktree({ lastTouchedAt: 0, hasDevServer: false, hasLiveSession: true, now })).toBe('active')
  })

  it('ages from active to idle to dormant', () => {
    const at = (days: number) =>
      classifyWorktree({ lastTouchedAt: now - days * DAY_MS, hasDevServer: false, hasLiveSession: false, now })

    expect(at(1)).toBe('active')
    expect(at(7)).toBe('idle')
    expect(at(30)).toBe('dormant')
  })
})

describe('activityDays', () => {
  it('buckets moves per local day with today last', () => {
    const now = Date.parse('2026-10-14T12:00:00')
    const days = activityDays([now - 1000, now - 2000, now - DAY_MS, now - 20 * DAY_MS], now, 3)

    expect(days).toEqual([0, 1, 2])
  })
})

describe('envOf and readEnvValue', () => {
  const rules = [
    { match: '-stg.', name: 'STG' },
    { match: 'app.example.com', name: 'PROD' },
  ]

  it('names the environment from the first rule that matches its host', () => {
    expect(envOf('https://app-stg.example.com/', rules)).toBe('STG')
    expect(envOf('https://app.example.com', rules)).toBe('PROD')
    expect(envOf('http://localhost:8080', rules)).toBe('LOCAL')
    expect(envOf('https://other.example.org/x')).toBe('other.example.org')
    expect(envOf('')).toBe('')
  })

  it('reads the last assignment of a key, unquoted', () => {
    expect(readEnvValue('APP_URL=a\nexport APP_URL="https://x"\n', 'APP_URL')).toBe('https://x')
  })
})

describe('toChecks and ciOf', () => {
  it('maps rollups to a CI state', () => {
    const running = toChecks([
      { __typename: 'CheckRun', name: 'unit', status: 'IN_PROGRESS' },
      { __typename: 'CheckRun', name: 'smoke', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ])

    expect(running.map(c => c.state)).toEqual(['pending', 'skipped'])
    expect(ciOf(running)).toBe('running')
    expect(ciOf(toChecks([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }]))).toBe('failing')
    expect(ciOf(toChecks([{ __typename: 'StatusContext', context: 'ci', state: 'SUCCESS' }]))).toBe('passing')
    expect(ciOf([])).toBe('none')
  })
})

describe('parseUsageLine', () => {
  const line = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-1',
      timestamp: '2026-10-14T18:07:01.597Z',
      message: {
        id: 'msg_1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 2, output_tokens: 379, cache_read_input_tokens: 27630, cache_creation_input_tokens: 36556 },
      },
      ...over,
    })

  it('reads one response usage', () => {
    expect(parseUsageLine(line())).toEqual({
      id: 'msg_1',
      sessionId: 'sess-1',
      at: Date.parse('2026-10-14T18:07:01.597Z'),
      model: 'claude-opus-5-5',
      input: 2,
      output: 379,
      cacheRead: 27630,
      cacheWrite: 36556,
    })
  })

  it('skips other rows, synthetic messages and broken lines', () => {
    expect(parseUsageLine(line({ type: 'user' }))).toBeNull()
    expect(parseUsageLine(line({ message: { id: 'x', model: '<synthetic>', usage: {} } }))).toBeNull()
    expect(parseUsageLine('{"type":"assistant","usage":')).toBeNull()
    expect(parseUsageLine('{"type":"summary"}')).toBeNull()
  })
})

describe('projectSlug and resumeCandidates', () => {
  it('names the transcript folder the way Claude Code does', () => {
    expect(projectSlug('/home/dev/projects/acme-app/.claude/worktrees/worktree-ABC-1')).toBe(
      '-home-dev-projects-acme-app--claude-worktrees-worktree-ABC-1',
    )
  })

  it('walks from the session folder up through every parent', () => {
    expect(resumeCandidates('/repo/.claude/worktrees/wt/a', '/repo/.claude/worktrees/wt')).toEqual([
      '/repo/.claude/worktrees/wt/a',
      '/repo/.claude/worktrees/wt',
      '/repo/.claude/worktrees',
      '/repo/.claude',
      '/repo',
    ])
    expect(resumeCandidates('/elsewhere/x', '/wt')).toEqual(['/elsewhere/x', '/elsewhere', '/wt'])
    expect(resumeCandidates('', '/wt')).toEqual(['/wt'])
  })
})

describe('procStartOf', () => {
  it('reads the start time even when the command name has spaces', () => {
    const fields = Array.from({ length: 50 }, (_, i) => String(i + 3))
    fields[19] = '2928696'

    expect(procStartOf(`731510 (claude code) ${fields.join(' ')}`)).toBe('2928696')
  })
})

describe('parseTitleLine', () => {
  it('reads the automatic title of a session', () => {
    expect(
      parseTitleLine('{"type":"ai-title","aiTitle":"Portar status-line para mods do Claude","sessionId":"07bc"}'),
    ).toEqual({ sessionId: '07bc', title: 'Portar status-line para mods do Claude' })
  })

  it('skips other rows and broken lines', () => {
    expect(parseTitleLine('{"type":"custom-title","customTitle":"x","sessionId":"a"}')).toBeNull()
    expect(parseTitleLine('{"type":"ai-title","aiTitle":"","sessionId":"a"}')).toBeNull()
    expect(parseTitleLine('{"type":"ai-title",')).toBeNull()
  })
})

describe('review queue helpers', () => {
  it('reads check labels', () => {
    expect(queueLabel('ci:test:sf - success')).toEqual({ name: 'ci:test:sf', state: 'success' })
    expect(queueLabel('pr-check - failure')).toEqual({ name: 'pr-check', state: 'failure' })
    expect(queueLabel('ci:forward')).toEqual({ name: 'ci:forward', state: 'other' })
  })

  it('recognizes forwarded branches by their sender', () => {
    expect(isSentBy('ci-forward-ABC-1077-pr-4204-sender-octocat', 'octocat', '-sender-{login}')).toBe(true)
    expect(isSentBy('ci-forward-ABC-1-pr-1-sender-someone-else', 'octocat', '-sender-{login}')).toBe(false)
    expect(isSentBy('ci-forward-ABC-1-pr-1-sender-octocat', '', '-sender-{login}')).toBe(false)
  })

  it('finds the ticket in a title', () => {
    expect(ticketOf('ABC-1077 Upgrade the build to Node 22')).toBe('ABC-1077')
    expect(ticketOf('No ticket here')).toBe('')
  })
})

describe('queueOutcome', () => {
  const reviewer = (body: string) => ({ author: { login: 'reviewer' }, body })
  const bot = (body: string) => ({ author: { login: 'ci-bot' }, body })

  it('is merged when the reviewer says so', () => {
    expect(queueOutcome([bot('ci:test'), reviewer('Merged. Thank you.\nView total diff: …')], 'reviewer')).toEqual({
      outcome: 'merged',
      reason: '',
    })
  })

  it('is rejected when the reviewer closes it with anything else, keeping the last word as the reason', () => {
    expect(queueOutcome([reviewer('@octocat rebase error')], 'reviewer')).toEqual({ outcome: 'rejected', reason: 'rebase error' })
    expect(queueOutcome([reviewer('first'), reviewer('@octocat\r\n\r\npress Enter\r\n\r\nshould be escape')], 'reviewer')).toEqual({
      outcome: 'rejected',
      reason: 'press Enter should be escape',
    })
  })

  it('is just closed when the reviewer never commented', () => {
    expect(queueOutcome([bot('ci:test:sf - success')], 'reviewer')).toEqual({ outcome: 'closed', reason: '' })
    expect(queueOutcome([], 'reviewer')).toEqual({ outcome: 'closed', reason: '' })
  })
})

describe('Claude activity', () => {
  it('counts the tool calls on an assistant row', () => {
    const row = JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      timestamp: '2026-10-14T18:07:01.597Z',
      message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use' }, { type: 'tool_use' }] },
    })

    expect(parseToolLine(row)).toEqual({ uuid: 'u1', at: Date.parse('2026-10-14T18:07:01.597Z'), tools: 2 })
    expect(parseToolLine(JSON.stringify({ type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_use' }] } }))).toBeNull()
  })

  it('takes the stats cache up to its computed day and transcripts after it', () => {
    const cache = { lastComputedDate: '2026-10-01', tools: { '2026-09-30': 360, '2026-10-01': 1195 } }
    const transcripts = { '2026-10-01': 1, '2026-10-02': 3850 }

    expect(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map(d => claudeActivity(d, cache, transcripts))).toEqual([
      360, 1195, 3850, 0,
    ])
  })
})

describe('isAgentFinished', () => {
  const row = (message: Record<string, unknown>, type = 'assistant') => JSON.stringify({ type, message })
  const call = (name: string) => row({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name }] })
  const result = row({ content: [{ type: 'tool_result' }] }, 'user')

  it('is finished on a final text answer', () => {
    expect(isAgentFinished([row({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'PASS' }] })])).toBe(true)
  })

  it('is finished once its report is handed back to the parent', () => {
    expect(isAgentFinished([row({ content: [{ type: 'thinking' }] }), call('SubagentHandback'), result])).toBe(true)
  })

  it('is still working mid tool call, on an ordinary tool result, or on an unreadable tail', () => {
    expect(isAgentFinished([call('Bash')])).toBe(false)
    expect(isAgentFinished([call('Bash'), result])).toBe(false)
    expect(isAgentFinished(['{"type":"assist'])).toBe(false)
    expect(isAgentFinished([])).toBe(false)
  })
})

describe('parseRecapLine', () => {
  it('reads the recap without the hint about turning recaps off', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'away_summary',
      sessionId: 's1',
      timestamp: '2026-10-15T03:00:09.932Z',
      content: 'Estamos montando o Claude console. Próximo passo: testar. (disable recaps in /config)',
    })

    expect(parseRecapLine(line)).toEqual({
      sessionId: 's1',
      at: Date.parse('2026-10-15T03:00:09.932Z'),
      text: 'Estamos montando o Claude console. Próximo passo: testar.',
    })
  })

  it('skips other system rows', () => {
    expect(parseRecapLine(JSON.stringify({ type: 'system', subtype: 'informational', sessionId: 's1', content: 'away_summary' }))).toBeNull()
  })
})

describe('parsePrLink', () => {
  it('reads the pull request Claude Code linked to a session', () => {
    const line = JSON.stringify({
      type: 'pr-link',
      sessionId: '00000000-0000-4000-8000-000000000002',
      prNumber: 604,
      prUrl: 'https://github.com/octocat/acme-app/pull/604',
    })

    expect(parsePrLink(line)).toEqual({
      sessionId: '00000000-0000-4000-8000-000000000002',
      url: 'https://github.com/octocat/acme-app/pull/604',
    })
  })

  it('ignores a pull request link that only appears in the conversation', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: '00000000-0000-4000-8000-000000000001',
      message: { content: [{ type: 'tool_result', content: 'https://github.com/octocat/acme-app/pull/604 "pr-link"' }] },
    })

    expect(parsePrLink(line)).toBeNull()
  })
})

describe('memory notes', () => {
  it('reads the frontmatter with the type under metadata, and the body', () => {
    const note = parseMemoryNote(
      '---\nname: claude-mods\ndescription: Personal mods in ~/.claude/mods\nmetadata:\n  type: reference\n---\n\nTwo personal mods.\n',
    )

    expect(note).toEqual({ name: 'claude-mods', description: 'Personal mods in ~/.claude/mods', type: 'reference', body: 'Two personal mods.' })
  })

  it('reads titles and hooks from the MEMORY.md index', () => {
    const index = parseMemoryIndex('- [Commit style](feedback_commit_style.md) — title-only: no body\n- not a link\n')

    expect(index.get('feedback_commit_style.md')).toEqual({ title: 'Commit style', hook: 'title-only: no body' })
    expect(index.size).toBe(1)
  })
})

describe('artifacts', () => {
  it('reads publish calls and skips reads, lists and asset uploads', () => {
    const row = (input: Record<string, unknown>) =>
      JSON.stringify({
        type: 'assistant',
        sessionId: 's1',
        timestamp: '2026-10-14T17:01:00.000Z',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Artifact', input }] },
      })

    expect(parseArtifactCalls(row({ file_path: '/tmp/guide.html', title: 'Guide' }))).toEqual([
      { id: 't1', sessionId: 's1', at: Date.parse('2026-10-14T17:01:00.000Z'), input: { file_path: '/tmp/guide.html', title: 'Guide' } },
    ])
    expect(parseArtifactCalls(row({ action: 'list' }))).toEqual([])
    expect(parseArtifactCalls(row({ url: 'x', asset: true, file_path: '/a.png' }))).toEqual([])
  })

  it('reads the URL and version a publish reports', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-10-14T17:02:00.000Z',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: 'Published /tmp/guide.html at https://claude.ai/artifact/2E4uBseQT6FRtLE5DCrBwd (Version 17, version id 1)',
          },
        ],
      },
    })
    const [result] = parseToolResults(line)

    expect(result!.toolUseId).toBe('t1')
    expect(publishedArtifact(result!.text)).toEqual({ url: 'https://claude.ai/artifact/2E4uBseQT6FRtLE5DCrBwd', version: 17 })
    expect(publishedArtifact('No published artifacts yet.')).toBeNull()
  })

  it("reads a page's title", () => {
    expect(htmlTitle('<html><head><title>  Live   Demo Guide </title>')).toBe('Live Demo Guide')
  })
})

describe('briefing', () => {
  it('looks back on yesterday, or the latest earlier day with work', () => {
    expect(briefingDay(['2026-10-13', '2026-10-14', '2026-10-15'], '2026-10-15')).toBe('2026-10-14')
    expect(briefingDay(['2026-10-10', '2026-10-13'], '2026-10-13')).toBe('2026-10-10')
    expect(briefingDay(['2026-10-15'], '2026-10-15')).toBeNull()
  })

  it("reads a conversation row's session, time, folder and branch, skipping subagents", () => {
    const row = JSON.stringify({
      type: 'assistant',
      sessionId: '00000000-0000-4000-8000-000000000003',
      timestamp: '2026-10-14T15:48:04.453Z',
      cwd: '/home/dev/projects/acme-app',
      gitBranch: 'ABC-1',
      isSidechain: false,
    })

    expect(parseSessionRow(row)).toEqual({
      sessionId: '00000000-0000-4000-8000-000000000003',
      at: Date.parse('2026-10-14T15:48:04.453Z'),
      cwd: '/home/dev/projects/acme-app',
      branch: 'ABC-1',
    })
    expect(parseSessionRow(row.replace('"isSidechain":false', '"isSidechain":true'))).toBeNull()
  })
})

describe('worktreeNameOf', () => {
  it('names the worktree, not the module folder a session ran in', () => {
    expect(worktreeNameOf('/r/acme-app/.claude/worktrees/worktree-ABC-1/workspaces/x/modules/web-app')).toBe('worktree-ABC-1')
    expect(worktreeNameOf('/home/dev/projects/acme-app/workspaces/web-workspace/modules/web-app')).toBe('acme-app')
    expect(worktreeNameOf('/home/dev/projects/acme-app')).toBe('acme-app')
  })
})

describe('remoteUrlOf', () => {
  it('builds the claude.ai address of a Remote Control session, and nothing else', async () => {
    const { remoteUrlOf } = await import('./collect')

    expect(remoteUrlOf('session_01AbCdEf')).toBe('https://claude.ai/code/session_01AbCdEf')
    expect(remoteUrlOf(undefined)).toBe('')
    expect(remoteUrlOf('session_x/../../evil')).toBe('')
    expect(remoteUrlOf('javascript:alert(1)')).toBe('')
  })
})
