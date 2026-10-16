import { useState } from 'react'

import type { StartResult, WorktreePlan } from '../server/startwork'
import { Modal, showNotice } from './App'

type Step = { kind: 'pick' } | { kind: 'just-start' } | { kind: 'confirm'; repos: string[]; plans: { repo: string; plan: WorktreePlan }[] }

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }

  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)

  return data
}

const PlanLine = ({ repo, plan }: { repo: string; plan: WorktreePlan }) => (
  <li className="start-plan" data-kind={plan.kind}>
    <strong>{repo}</strong>
    {plan.kind === 'reuse' && <span> reuses {plan.path}</span>}
    {plan.kind === 'blocked' && <span> is blocked: {plan.reason}</span>}
    {plan.kind === 'create' && (
      <>
        <span> gets {plan.path}</span>
        {plan.commands.map(argv => (
          <code key={argv.join(' ')} className="start-command">
            {argv.join(' ')}
          </code>
        ))}
      </>
    )}
  </li>
)

const resultText = (result: StartResult) =>
  result.ok ? `${result.repo}: opened in ${result.path}` : `${result.repo}: ${result.error ?? 'failed'}`

// Starts work on a ticket: pick the repositories (or just a session), see the
// exact git commands, and confirm once. The server creates the worktrees and
// opens a Claude session in each, whose first message reads the ticket.
export const StartWorkButton = ({ issueKey, repos, isSmall = false }: { issueKey: string; repos: string[]; isSmall?: boolean }) => {
  const [step, setStep] = useState<Step | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    setStep(null)
    setError('')
  }

  const preview = async (picked: string[]) => {
    setIsBusy(true)
    setError('')

    try {
      const { plans } = await post<{ plans: { repo: string; plan: WorktreePlan }[] }>('/api/ticket/plan', {
        key: issueKey,
        repos: picked,
      })

      setStep({ kind: 'confirm', repos: picked, plans })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setIsBusy(false)
    }
  }

  const run = async (path: string, body: unknown) => {
    setIsBusy(true)
    setError('')

    try {
      const { results } = await post<{ results: StartResult[] }>(path, body)

      close()
      window.dispatchEvent(new Event('claude-console:refresh'))
      await showNotice(
        `Started ${issueKey}`,
        <ul className="start-results">
          {results.map(result => (
            <li key={result.repo} data-ok={result.ok}>
              {resultText(result)}
            </li>
          ))}
        </ul>,
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setIsBusy(false)
    }
  }

  const canStart = step?.kind === 'confirm' && step.plans.some(p => p.plan.kind !== 'blocked')

  return (
    <>
      <button
        type="button"
        className="start-work"
        data-small={isSmall || undefined}
        aria-haspopup="dialog"
        title={`Start work on ${issueKey}`}
        onClick={() => setStep({ kind: 'pick' })}
      >
        Start work
      </button>
      {step && (
        <Modal
          title={`Start work on ${issueKey}`}
          onClose={close}
          actions={
            <>
              <button type="button" onClick={close}>
                Cancel
              </button>
              {step.kind === 'confirm' && (
                <button
                  type="button"
                  className="primary"
                  disabled={!canStart || isBusy}
                  onClick={() => void run('/api/ticket/start', { key: issueKey, repos: step.repos })}
                >
                  {isBusy ? 'Starting…' : 'Start'}
                </button>
              )}
            </>
          }
        >
          {step.kind === 'pick' && (
            <>
              <p className="modal-text">Where does this ticket's work go?</p>
              <div className="start-choices">
                {repos.map(repo => (
                  <button key={repo} type="button" disabled={isBusy} onClick={() => void preview([repo])}>
                    {repo}
                  </button>
                ))}
                {repos.length > 1 && (
                  <button type="button" disabled={isBusy} onClick={() => void preview(repos)}>
                    Both
                  </button>
                )}
                <button type="button" disabled={isBusy} onClick={() => setStep({ kind: 'just-start' })}>
                  Just start
                </button>
              </div>
            </>
          )}
          {step.kind === 'just-start' && (
            <>
              <p className="modal-text">
                Opens a Claude session in the repository's main checkout with the ticket loaded, and no worktree or
                branch. Which repository?
              </p>
              <div className="start-choices">
                {repos.map(repo => (
                  <button
                    key={repo}
                    type="button"
                    disabled={isBusy}
                    onClick={() => void run('/api/ticket/just-start', { key: issueKey, repo })}
                  >
                    {repo}
                  </button>
                ))}
              </div>
            </>
          )}
          {step.kind === 'confirm' && (
            <>
              <p className="modal-text">
                This runs the commands below, then opens a Claude session in each worktree that reads {issueKey}.
              </p>
              <ul className="start-plans">
                {step.plans.map(p => (
                  <PlanLine key={p.repo} repo={p.repo} plan={p.plan} />
                ))}
              </ul>
            </>
          )}
          {isBusy && step.kind !== 'confirm' && (
            <p className="modal-hint" role="status">
              Fetching and checking the repositories…
            </p>
          )}
          {error && (
            <p className="modal-hint" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  )
}
