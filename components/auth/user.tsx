'use client'

import { SignOut } from './sign-out'
import { SignIn } from './sign-in'
import { type Session } from '@/lib/session/types'
import { useAtomValue } from 'jotai'
import { sessionAtom, sessionInitializedAtom } from '@/lib/atoms/session'
import { useMemo } from 'react'

export function User({ user: initialUser }: Readonly<{ user?: Session['user'] | null }>) {
  const session = useAtomValue(sessionAtom)
  const initialized = useAtomValue(sessionInitializedAtom)

  // Use session values if initialized, otherwise use props
  const user = useMemo(
    () => (initialized ? (session.user ?? null) : (initialUser ?? null)),
    [initialized, session.user, initialUser],
  )

  if (user) {
    return <SignOut user={user} />
  } else {
    return <SignIn />
  }
}
