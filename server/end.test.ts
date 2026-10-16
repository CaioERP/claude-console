import { describe, expect, it } from 'vitest'

import { tabPlan } from './end'

describe('tabPlan', () => {
  it('closes the tab when Claude Code runs in a shell straight inside Ghostty', () => {
    expect(tabPlan('zsh', 'ghostty', [])).toEqual({ closeTab: true })
  })

  it('keeps the tab when anything else still runs in the shell', () => {
    expect(tabPlan('zsh', 'ghostty', ['node'])).toEqual({ closeTab: false, reason: 'node still runs in it' })
  })

  it('keeps the tab outside a plain shell in Ghostty', () => {
    expect(tabPlan('tmux: server', 'ghostty', []).closeTab).toBe(false)
    expect(tabPlan('bash', 'gnome-terminal-', []).closeTab).toBe(false)
  })
})
