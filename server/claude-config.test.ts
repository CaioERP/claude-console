import { describe, expect, it } from 'vitest'

import { parseMcpLine, parseSkillUses } from './pure'

describe('parseMcpLine', () => {
  it('reads each health state', () => {
    expect(parseMcpLine('plan-server: npx tsx /srv/index.ts - ✔ Connected')).toEqual({
      name: 'plan-server', target: 'npx tsx /srv/index.ts', status: 'connected', detail: '',
    })
    expect(parseMcpLine('claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication')?.status).toBe('auth')
    expect(parseMcpLine('local: http://localhost:7400/o/mcp (HTTP) - ✘ Failed to connect — ECONNREFUSED')).toEqual({
      name: 'local', target: 'http://localhost:7400/o/mcp (HTTP)', status: 'failed', detail: 'ECONNREFUSED',
    })
  })

  it('drops query strings that may carry a key, and skips other lines', () => {
    expect(parseMcpLine('x: https://example.com/mcp?key=secret - ✔ Connected')?.target).toBe('https://example.com/mcp')
    expect(parseMcpLine('Checking MCP server health…')).toBeNull()
  })
})

describe('parseSkillUses', () => {
  it('counts a skill Claude called and one the person typed', () => {
    const called = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-10-16T10:00:00Z',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: 'format-source' } }] },
    })
    const typed = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-10-16T11:00:00Z',
      message: { content: '<command-message>backport</command-message>\n<command-name>/backport</command-name>' },
    })

    expect(parseSkillUses(called)).toEqual([{ id: 'toolu_1', name: 'format-source', at: Date.parse('2026-10-16T10:00:00Z') }])
    expect(parseSkillUses(typed)).toEqual([{ id: 'u1', name: 'backport', at: Date.parse('2026-10-16T11:00:00Z') }])
  })

  it('ignores a command name merely quoted in a message or a subagent', () => {
    const quoted = JSON.stringify({ type: 'user', uuid: 'u2', message: { content: 'see <command-name>/x</command-name>' } })
    const sidechain = JSON.stringify({
      type: 'user', uuid: 'u3', isSidechain: true, message: { content: '<command-message>x</command-message><command-name>/x</command-name>' },
    })

    expect(parseSkillUses(quoted)).toEqual([])
    expect(parseSkillUses(sidechain)).toEqual([])
  })
})
