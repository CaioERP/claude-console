import { execFile } from 'node:child_process'

import type { Profile } from '../shared/types'

// The GitHub profile of the account gh is signed in with.
export const collectProfile = () =>
  new Promise<Profile>((resolve, reject) => {
    execFile('gh', ['api', 'user'], { timeout: 30_000 }, (error, stdout) => {
      if (error) return reject(error)

      const user = JSON.parse(stdout) as {
        login: string
        name?: string
        bio?: string
        location?: string
        avatar_url: string
        html_url: string
      }

      resolve({
        login: user.login,
        name: user.name || user.login,
        bio: user.bio ?? '',
        location: user.location ?? '',
        avatarUrl: user.avatar_url,
        url: user.html_url,
      })
    })
  })
