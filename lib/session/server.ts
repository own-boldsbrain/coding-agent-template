import { decryptJWE } from '@/lib/jwe/decrypt'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME } from './constants'
import type { Session } from './types'

export async function getSessionFromCookie(cookieValue?: string): Promise<Session | undefined> {
  if (cookieValue) {
    const decrypted = await decryptJWE<Session>(cookieValue)
    if (decrypted) {
      return decrypted
    }
  }
}

export async function getSessionFromReq(req: NextRequest): Promise<Session | undefined> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value
  return getSessionFromCookie(cookieValue)
}
