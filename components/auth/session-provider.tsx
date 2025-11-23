'use client'

import { githubConnectionAtom, githubConnectionInitializedAtom } from '@/lib/atoms/github-connection'
import type { GitHubConnection } from '@/lib/atoms/github-connection'
import { sessionAtom, sessionInitializedAtom } from '@/lib/atoms/session'
import type { SessionUserInfo } from '@/lib/session/types'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

export function SessionProvider() {
  const setSession = useSetAtom(sessionAtom)
  const setInitialized = useSetAtom(sessionInitializedAtom)
  const setGitHubConnection = useSetAtom(githubConnectionAtom)
  const setGitHubInitialized = useSetAtom(githubConnectionInitializedAtom)

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch('/api/auth/info')
        const data: SessionUserInfo = await response.json()
        setSession(data)
        setInitialized(true)
      } catch (error) {
        console.error('Failed to fetch session:', error)
        setSession({ user: undefined })
        setInitialized(true)
      }
    }

    const fetchGitHubConnection = async () => {
      try {
        const response = await fetch('/api/auth/github/status')
        const data: GitHubConnection = await response.json()
        setGitHubConnection(data)
        setGitHubInitialized(true)
      } catch (error) {
        console.error('Failed to fetch GitHub connection:', error)
        setGitHubConnection({ connected: false })
        setGitHubInitialized(true)
      }
    }

    const fetchAll = async () => {
      await Promise.all([fetchSession(), fetchGitHubConnection()])
    }

    fetchAll()

    // Refresh both every minute
    const interval = setInterval(fetchAll, 60000)

    // Refresh on focus
    const handleFocus = () => fetchAll()
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [setSession, setInitialized, setGitHubConnection, setGitHubInitialized])

  return null
}
