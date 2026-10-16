import { useCallback, useEffect, useState } from 'react'

import type { ServicesStatus, ServiceStack, Session } from '../shared/types'
import { askConfirm, showNotice } from './App'
import { ago } from './format'
import { needsReminder } from './serviceReminder'

const POLL_MS = 10_000

const STATE_LABEL = { up: 'Up', partial: 'Partly up', down: 'Down' } as const

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const useServices = () => {
  const [status, setStatus] = useState<ServicesStatus | null>(null)

  const load = useCallback(async () => {
    const response = await fetch('/api/services').catch(() => null)

    if (response?.ok) setStatus((await response.json()) as ServicesStatus)
  }, [])

  useEffect(() => {
    void load()

    const timer = setInterval(() => void load(), POLL_MS)

    return () => clearInterval(timer)
  }, [load])

  return { status, setStatus }
}

const act = async (action: 'start' | 'stop', name: string): Promise<ServicesStatus | null> => {
  const response = await fetch(`/api/services/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Claude-Console': '1' },
    body: JSON.stringify({ name }),
  })
  const body = (await response.json().catch(() => ({}))) as ServicesStatus & { error?: string }

  if (!response.ok) {
    await showNotice(`Could not ${action} ${name}`, <p className="modal-text">{body.error ?? `HTTP ${response.status}`}</p>)

    return null
  }

  return body
}

const StackBlock = ({
  stack,
  isAvailable,
  sessions,
  now,
  onChange,
}: {
  stack: ServiceStack
  isAvailable: boolean
  sessions: Session[]
  now: number
  onChange: (status: ServicesStatus) => void
}) => {
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null)
  const heldElsewhere = stack.state !== 'down' && !stack.isOwnCheckout

  const run = async (action: 'start' | 'stop') => {
    if (action === 'stop') {
      const isSure = await askConfirm({
        title: `Stop ${stack.name}?`,
        body: (
          <p className="modal-text">
            Runs <code>docker compose -p {stack.project} down</code>, which stops and removes the containers started from{' '}
            <strong>{stack.workingDir}</strong>.
          </p>
        ),
        confirmLabel: 'Stop',
        isDanger: true,
      })

      if (!isSure) return
    }

    setBusy(action)

    const status = await act(action, stack.name)

    setBusy(null)

    if (status) onChange(status)
  }

  return (
    <li className="service" data-state={stack.state}>
      <span className="service-head">
        <span className="service-dot" aria-hidden />
        <strong>{stack.name}</strong>
        <span className="service-state">
          {STATE_LABEL[stack.state]}
          {stack.upSince && stack.state !== 'down' && ` · started ${ago(stack.upSince, now)}`}
        </span>
        <span className="service-actions">
          <button
            type="button"
            disabled={!isAvailable || stack.state === 'up' || heldElsewhere || busy !== null}
            title={heldElsewhere ? `Runs from ${stack.workingDir}` : undefined}
            onClick={() => void run('start')}
          >
            {busy === 'start' ? 'Starting…' : 'Start'}
          </button>
          <button type="button" disabled={!isAvailable || stack.state === 'down' || busy !== null} onClick={() => void run('stop')}>
            {busy === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
        </span>
      </span>
      {stack.workingDir && stack.state !== 'down' && (
        <span className="service-origin">from {stack.isOwnCheckout ? folderName(stack.workingDir) : stack.workingDir}</span>
      )}
      {needsReminder(stack, sessions, now) && (
        <span className="service-reminder">Still up and no Claude session is running. Stop it if you are done.</span>
      )}
      {stack.state !== 'down' && (
        <ul className="service-containers">
          {stack.containers.map(c => (
            <li key={c.name} data-state={c.state}>
              <code>{c.name}</code> {c.state}
              {c.ports && <span className="service-ports"> {c.ports}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

// The Docker Compose stacks from the configuration: whether they run, from
// which checkout, and buttons to start or stop them.
export const ServicesPanel = ({ sessions, now }: { sessions: Session[]; now: number }) => {
  const { status, setStatus } = useServices()

  return (
    <section className="panel services" aria-labelledby="services-title">
      <header className="panel-head">
        <h2 id="services-title">Services</h2>
      </header>
      {!status ? (
        <p className="empty">Asking Docker…</p>
      ) : (
        <>
          {!status.available && <p className="empty">Docker is not available: {status.reason}</p>}
          <ul className="service-list">
            {status.stacks.map(stack => (
              <StackBlock
                key={stack.name}
                stack={stack}
                isAvailable={status.available}
                sessions={sessions}
                now={now}
                onChange={setStatus}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
