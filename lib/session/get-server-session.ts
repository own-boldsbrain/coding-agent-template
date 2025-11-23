import { cookies } from 'next/headers'
import { cache } from 'react'
import { SESSION_COOKIE_NAME } from './constants'
import { getSessionFromCookie } from './server'

export const getServerSession = cache(async () => {
  const store = await cookies()
  const cookieValue = store.get(SESSION_COOKIE_NAME)?.value
  return getSessionFromCookie(cookieValue)
})
