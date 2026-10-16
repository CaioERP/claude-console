import { spawn } from 'node:child_process'

import type { JiraIssue } from '../shared/types'
import type { ConsoleConfig } from './config'

// Runs curl with its configuration on standard input, so the credentials never
// show up in the process list the way a --user argument would.
const curl = (config: string, timeoutMs = 30_000) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn('curl', ['--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    let out = ''
    let err = ''

    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (err += chunk))
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `curl exited with ${code}`))
    })
    child.stdin.end(config)
  })

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

type RawIssue = {
  key: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { key: string } }
    issuetype: { name: string }
    priority?: { name: string } | null
    updated: string
    parent?: { key: string; fields?: { summary?: string } } | null
  }
}

export const toIssue = (raw: RawIssue, site: string): JiraIssue => ({
  key: raw.key,
  summary: raw.fields.summary,
  status: raw.fields.status.name,
  statusCategory: raw.fields.status.statusCategory.key,
  type: raw.fields.issuetype.name,
  priority: raw.fields.priority?.name ?? '',
  updatedAt: Date.parse(raw.fields.updated),
  parentKey: raw.fields.parent?.key ?? '',
  parentSummary: raw.fields.parent?.fields?.summary ?? '',
  url: `${site}/browse/${raw.key}`,
})

// Reads a Jira Cloud REST path with the configured credentials.
const jiraGet = async (jira: NonNullable<ConsoleConfig['jira']>, path: string) => {
  const user = process.env.JIRA_API_USER
  const token = process.env.JIRA_API_TOKEN

  if (!user || !token) {
    throw new Error('JIRA_API_USER and JIRA_API_TOKEN are not set; put them in ~/.config/claude-console/env (chmod 600)')
  }

  return curl(
    [
      'silent',
      'show-error',
      'fail',
      `user = ${quote(`${user}:${token}`)}`,
      `url = ${quote(`${jira.site}${path}`)}`,
      'header = "Accept: application/json"',
    ].join('\n'),
  )
}

export const collectJira = async (jira: NonNullable<ConsoleConfig['jira']>): Promise<JiraIssue[]> => {
  const params = new URLSearchParams({
    jql: jira.jql,
    fields: 'summary,status,issuetype,priority,updated,parent',
    maxResults: '100',
  })
  const data = JSON.parse(await jiraGet(jira, `/rest/api/3/search/jql?${params}`)) as { issues?: RawIssue[] }

  return (data.issues ?? []).map(raw => toIssue(raw, jira.site))
}

type AdfNode = { type?: string; text?: string; content?: AdfNode[] }

const inlineText = (node: AdfNode): string =>
  node.type === 'text' ? (node.text ?? '') : node.type === 'hardBreak' ? '\n' : (node.content ?? []).map(inlineText).join('')

const blockText = (node: AdfNode): string => {
  switch (node.type) {
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? []).map(item => `- ${(item.content ?? []).map(blockText).join('\n')}`).join('\n')
    case 'doc':
    case 'blockquote':
    case 'panel':
    case 'expand':
      return (node.content ?? []).map(blockText).filter(Boolean).join('\n\n')
    default:
      return inlineText(node)
  }
}

// A Jira description, stored as Atlassian Document Format, as plain text:
// blocks separated by a blank line and list items as "- " lines.
export const adfToText = (node: unknown) => (node && typeof node === 'object' ? blockText(node as AdfNode).trim() : '')

export const fetchDescription = async (jira: NonNullable<ConsoleConfig['jira']>, key: string) => {
  const data = JSON.parse(await jiraGet(jira, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description`)) as {
    fields?: { description?: unknown }
  }

  return adfToText(data.fields?.description)
}
