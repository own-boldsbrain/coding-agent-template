import type { NextRequest } from 'next/server'
import type { Session, SessionUserInfo } from '@/lib/session/types'
import { saveSession } from '@/lib/session/create-github'
import { getSessionFromReq } from '@/lib/session/server'

export async function GET(req: NextRequest) {
  const existingSession = await getSessionFromReq(req)

  const session = existingSession ?? undefined

  const response = new Response(JSON.stringify(await getData(session)), {
    headers: { 'Content-Type': 'application/json' },
  })

  await saveSession(response, session)

  return response
}

async function getData(session: Session | undefined): Promise<SessionUserInfo> {
  if (session) {
    return { user: session.user }
  }

  return { user: undefined }
}
