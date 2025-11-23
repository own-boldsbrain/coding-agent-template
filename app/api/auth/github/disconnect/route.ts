import { getSessionFromReq } from '@/lib/session/server'
import type { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const session = await getSessionFromReq(req)

  if (!session?.user) {
    console.log('Disconnect GitHub: No session found')
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (!session.user.id) {
    console.error('Session user.id is undefined. Session:', session)
    return Response.json({ error: 'Invalid session - user ID missing' }, { status: 400 })
  }

  // GitHub is the only authentication provider, so disconnecting would lock the user out
  return Response.json({ error: 'Cannot disconnect primary authentication method' }, { status: 400 })
}
