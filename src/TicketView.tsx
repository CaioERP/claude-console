import { useContext, useEffect, useState, type ReactNode } from 'react'

import type { JiraIssue, Session, Snapshot, TicketDetail, Worktree } from '../shared/types'
import { mentions } from './format'
import { StartWorkButton } from './StartWork'
import { TicketKeys, keyIn, openTicket, ticketHref } from './tickets'

// A small chip on a worktree or session row that opens its ticket's view, for
// tickets in the Jira list.
export const TicketChip = ({ text }: { text: string }) => {
  const key = keyIn(text, useContext(TicketKeys))

  return key ? <TicketLink ticketKey={key} className="tag ticket-chip" /> : null
}

export const TicketLink = ({ ticketKey, className, children }: { ticketKey: string; className?: string; children?: ReactNode }) => (
  <a
    className={className}
    href={ticketHref(ticketKey)}
    title={`Open everything linked to ${ticketKey}`}
    onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return

      event.preventDefault()
      openTicket(ticketKey)
    }}
  >
    {children ?? ticketKey}
  </a>
)

const STATE_LABEL = { open: 'Open', merged: 'Merged', closed: 'Closed' } as const

const useTicketDetail = (key: string, isKnown: boolean) => {
  const [detail, setDetail] = useState<TicketDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isKnown) return

    let isCurrent = true

    setDetail(null)
    setError('')
    fetch(`/api/ticket?key=${encodeURIComponent(key)}`)
      .then(async response => {
        const body = (await response.json()) as TicketDetail & { error?: string }

        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
        if (isCurrent) setDetail(body)
      })
      .catch(failure => isCurrent && setError(failure instanceof Error ? failure.message : String(failure)))

    return () => {
      isCurrent = false
    }
  }, [key, isKnown])

  return { detail, error }
}

// Everything linked to one ticket: its description, its worktrees in every
// repository, the chain of pull requests it went through, and its sessions.
export const TicketView = ({
  issue,
  ticketKey,
  snapshot,
  renderWorktree,
  renderSession,
}: {
  issue: JiraIssue | undefined
  ticketKey: string
  snapshot: Snapshot
  renderWorktree: (worktree: Worktree) => ReactNode
  renderSession: (session: Session) => ReactNode
}) => {
  const { detail, error } = useTicketDetail(ticketKey, !!issue)
  const back = (
    <a
      className="ticket-back"
      href="./"
      onClick={event => {
        event.preventDefault()
        openTicket(null)
      }}
    >
      ← Back to the console
    </a>
  )

  if (!issue) {
    return (
      <section className="panel ticket-view">
        {back}
        <h2>{ticketKey}</h2>
        <p className="empty">
          Not in your Jira list.{' '}
          {snapshot.jira[0] && <a href={snapshot.jira[0].url.replace(snapshot.jira[0].key, ticketKey)}>Open it in Jira</a>}
        </p>
      </section>
    )
  }

  const worktrees = snapshot.worktrees.filter(w => mentions(w.branch, ticketKey) || mentions(w.name, ticketKey))
  const sessions = snapshot.sessions.filter(s => mentions(s.branch, ticketKey))
  const startable = (snapshot.features.startWork?.repos ?? []).filter(name => !worktrees.some(w => w.repoName === name))
  const byRepo = [...new Set(worktrees.map(w => w.repoName))]

  return (
    <section className="panel ticket-view" aria-labelledby="ticket-title">
      {back}
      <header className="ticket-head">
        <h2 id="ticket-title">
          <a href={issue.url}>{issue.key}</a> {issue.summary}
        </h2>
        <p className="ticket-meta">
          <span>{issue.status}</span>
          <span>{issue.type}</span>
          {issue.priority && <span>{issue.priority}</span>}
          {issue.parentKey && (
            <a href={issue.url.replace(issue.key, issue.parentKey)} title={issue.parentKey}>
              {issue.parentSummary || issue.parentKey}
            </a>
          )}
        </p>
      </header>

      <h3>Description</h3>
      {error ? (
        <p className="empty">Could not load the ticket: {error}</p>
      ) : !detail ? (
        <p className="empty">Loading…</p>
      ) : detail.description ? (
        <p className="ticket-description">{detail.description}</p>
      ) : (
        <p className="empty">No description.</p>
      )}

      <h3>Worktrees</h3>
      {worktrees.length === 0 && <p className="empty">No worktree yet.</p>}
      {byRepo.map(repo => (
        <div key={repo || 'repo'}>
          {byRepo.length > 1 && <h4 className="ticket-repo">{repo}</h4>}
          <ul className="wt-list">{worktrees.filter(w => w.repoName === repo).map(renderWorktree)}</ul>
        </div>
      ))}
      {startable.length > 0 && (
        <p className="ticket-start">
          <StartWorkButton issueKey={ticketKey} repos={startable} />
        </p>
      )}

      <h3>Pull requests</h3>
      {!detail && !error && <p className="empty">Loading…</p>}
      {detail && detail.prs.length === 0 && <p className="empty">No pull request mentions {ticketKey}.</p>}
      {detail && detail.prs.length > 0 && (
        <ol className="ticket-prs">
          {detail.prs.map(pr => (
            <li key={pr.url} data-state={pr.state}>
              <a href={pr.url}>
                {pr.repo}#{pr.number}
              </a>{' '}
              <span className="ticket-pr-title">{pr.title}</span>
              <span className="ticket-pr-meta">
                {STATE_LABEL[pr.state]}
                {pr.author && ` · ${pr.author}`}
                {pr.ci !== 'none' && ` · CI ${pr.ci}`}
                {` · ${new Date(pr.createdAt).toLocaleDateString()}`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {detail?.prErrors.map(e => (
        <p key={e.repo} className="empty">
          Could not read {e.repo}: {e.error}
        </p>
      ))}

      <h3>Claude sessions</h3>
      {sessions.length === 0 ? <p className="empty">No session on this ticket.</p> : <ul className="session-list">{sessions.map(renderSession)}</ul>}
    </section>
  )
}
