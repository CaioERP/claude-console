import { createContext, useSyncExternalStore } from 'react'

import { mentions } from './format'

// The ticket a branch, folder or title refers to, among the given keys.
export const keyIn = (text: string, keys: string[]) => (text ? (keys.find(key => mentions(text, key)) ?? null) : null)

export const ticketHref = (key: string) => `?ticket=${key}`

const TICKET_EVENT = 'claude-console:ticket'

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange)
  window.addEventListener(TICKET_EVENT, onChange)

  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(TICKET_EVENT, onChange)
  }
}

const currentTicket = () => new URLSearchParams(location.search).get('ticket')

// Opens or closes the ticket view; the URL is the state, so Back works and a
// ticket's view can be bookmarked.
export const openTicket = (key: string | null) => {
  history.pushState(null, '', key ? ticketHref(key) : location.pathname)
  window.dispatchEvent(new Event(TICKET_EVENT))
  window.scrollTo({ top: 0 })
}

export const useTicketParam = (): [string | null, (key: string | null) => void] => [
  useSyncExternalStore(subscribe, currentTicket, () => null),
  openTicket,
]

// The keys of the tickets in the Jira list, the only ones with a view.
export const TicketKeys = createContext<string[]>([])
