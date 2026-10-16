import { createContext, useEffect, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

import { mentions } from './format'

// The ticket a branch, folder or title refers to, among the given keys.
export const keyIn = (text: string, keys: string[]) => (text ? (keys.find(key => mentions(text, key)) ?? null) : null)

export const ticketHref = (key: string) => `?ticket=${key}`

const TICKET_EVENT = 'claude-console:ticket'

const subscribe = (onChange: () => void) => {
  window.addEventListener(TICKET_EVENT, onChange)

  return () => window.removeEventListener(TICKET_EVENT, onChange)
}

const currentTicket = () => new URLSearchParams(location.search).get('ticket')

type NavState = { ticket?: string; scrollY?: number } | null

// Swaps the page with a short cross-fade where the browser supports it, so
// moving between the console and a ticket doesn't jump.
// The scroll position is set once the new page is in the DOM.
const withTransition = (change: () => void, scrollTop: () => number) => {
  type Transition = { updateCallbackDone: Promise<void> }
  const start = (document as Document & { startViewTransition?: (update: () => void) => Transition }).startViewTransition
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const scroll = () => requestAnimationFrame(() => window.scrollTo({ top: scrollTop() }))

  if (start && !reduced) {
    start.call(document, () => flushSync(change)).updateCallbackDone.then(scroll, scroll)
  } else {
    change()
    scroll()
  }
}

// Opens or closes the ticket view; the URL is the state, so Back works and a
// ticket's view can be bookmarked. The console's scroll position is kept on its
// history entry, so coming back lands where you left.
export const openTicket = (key: string | null) => {
  const state = history.state as NavState

  if (!key && state?.ticket && history.length > 1) {
    history.back()
    return
  }

  if (key && !state?.ticket) history.replaceState({ ...state, scrollY: window.scrollY }, '')

  withTransition(
    () => {
      history.pushState(key ? { ticket: key } : null, '', key ? ticketHref(key) : location.pathname)
      window.dispatchEvent(new Event(TICKET_EVENT))
    },
    () => 0,
  )
}

// Back and Forward through the browser: fade too, and put the console back at
// the scroll position it had.
export const useTicketHistory = () => {
  useEffect(() => {
    history.scrollRestoration = 'manual'

    const onPop = (event: PopStateEvent) => {
      const state = event.state as NavState

      withTransition(
        () => window.dispatchEvent(new Event(TICKET_EVENT)),
        () => (state?.ticket ? 0 : (state?.scrollY ?? 0)),
      )
    }

    window.addEventListener('popstate', onPop)

    return () => window.removeEventListener('popstate', onPop)
  }, [])
}

export const useTicketParam = (): [string | null, (key: string | null) => void] => [
  useSyncExternalStore(subscribe, currentTicket, () => null),
  openTicket,
]

// The keys of the tickets in the Jira list, the only ones with a view.
export const TicketKeys = createContext<string[]>([])
