import type { NextRequest } from 'next/server'
import { getSessionFromReq } from '@/lib/session/server'
import { isRelativeUrl } from '@/lib/utils/is-relative-url'
import { saveSession } from '@/lib/session/create-github'
import { getOAuthToken } from '@/lib/session/get-oauth-token'

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (session) {
    try {
      const tokenData = await getOAuthToken(session.user.id)
      if (tokenData) {
        const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? ''
        const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? ''
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        await fetch(`https://api.github.com/applications/${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID}/token`, {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: 'application/vnd.github.v3+json',
          },
          body: JSON.stringify({ access_token: tokenData.accessToken }),
        })
      }
    } catch (error) {
      console.error('Failed to revoke GitHub token:', error)
    }
  }

  const next = req.nextUrl.searchParams.get('next') ?? '/'
  const response = Response.json({
    url: isRelativeUrl(next) ? next : '/',
  })

  await saveSession(response, undefined)
  return response
}
