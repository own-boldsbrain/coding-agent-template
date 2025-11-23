import { encrypt } from '@/lib/crypto'
import { db } from '@/lib/db/client'
import { accounts, connectors, keys, tasks, users } from '@/lib/db/schema'
import { createGitHubSession, saveSession } from '@/lib/session/create-github'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

type CookieStore = Awaited<ReturnType<typeof cookies>>

interface TokenResponseData {
  access_token: string
  scope: string
  token_type: string
  error?: string
  error_description?: string
}

type OAuthFlowValidationResult =
  | {
      status: 'signin'
      redirectTo: string
      code: string
    }
  | {
      status: 'connect'
      redirectTo: string
      code: string
      connectUserId: string
    }
  | {
      status: 'error'
      response: Response
    }

export async function GET(req: NextRequest): Promise<Response> {
  const searchParams = req.nextUrl.searchParams
  const cookieStore = await cookies()
  const authMode = cookieStore.get('github_auth_mode')?.value ?? null
  const storedState = cookieStore.get(authMode ? 'github_auth_state' : 'github_oauth_state')?.value ?? null
  const storedRedirectTo =
    cookieStore.get(authMode ? 'github_auth_redirect_to' : 'github_oauth_redirect_to')?.value ?? null
  const storedUserId = cookieStore.get('github_oauth_user_id')?.value ?? null

  const flowValidation = validateOAuthState({
    code: searchParams.get('code'),
    state: searchParams.get('state'),
    storedRedirectTo,
    storedState,
    storedUserId,
    flowType: authMode === 'signin' ? 'signin' : 'connect',
  })

  if (flowValidation.status === 'error') {
    return flowValidation.response
  }

  const oauthConfig = getGitHubOAuthConfig()
  if (!oauthConfig) {
    return new Response('GitHub OAuth not configured', {
      status: 500,
    })
  }

  try {
    const tokenData = await exchangeCodeForToken(flowValidation.code, oauthConfig)
    const githubUser = await fetchGitHubUser(tokenData.access_token)

    if (flowValidation.status === 'signin') {
      const response = await handleSignInFlow({
        redirectTo: flowValidation.redirectTo,
        cookieStore,
        tokenData,
      })
      cleanupOAuthCookies(cookieStore, authMode)
      return response
    }

    await handleConnectFlow({
      tokenData,
      githubUser,
      storedUserId: flowValidation.connectUserId,
    })

    cleanupOAuthCookies(cookieStore, authMode)
    return Response.redirect(new URL(flowValidation.redirectTo, req.nextUrl.origin))
  } catch (error) {
    console.error('[GitHub Callback] OAuth callback error', error)
    return new Response('Failed to complete GitHub authentication', { status: 500 })
  }
}

function validateOAuthState(params: {
  code: string | null
  state: string | null
  storedState: string | null
  storedRedirectTo: string | null
  storedUserId: string | null
  flowType: 'signin' | 'connect'
}): OAuthFlowValidationResult {
  const { code, state, storedState, storedRedirectTo, storedUserId, flowType } = params

  if (!code || !state || !storedState || storedState !== state || !storedRedirectTo) {
    return {
      status: 'error',
      response: new Response('Invalid OAuth state', { status: 400 }),
    }
  }

  if (flowType === 'signin') {
    return {
      status: 'signin',
      redirectTo: storedRedirectTo,
      code,
    }
  }

  if (!storedUserId) {
    return {
      status: 'error',
      response: new Response('Invalid OAuth state', { status: 400 }),
    }
  }

  return {
    status: 'connect',
    redirectTo: storedRedirectTo,
    code,
    connectUserId: storedUserId,
  }
}

function getGitHubOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return null
  }

  return { clientId, clientSecret }
}

async function exchangeCodeForToken(code: string, config: { clientId: string; clientSecret: string }) {
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  })

  if (!tokenResponse.ok) {
    throw new Error('Failed to exchange code for token')
  }

  const tokenData = (await tokenResponse.json()) as TokenResponseData

  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'Unknown error')
  }

  return tokenData
}

async function fetchGitHubUser(accessToken: string) {
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!userResponse.ok) {
    throw new Error('Failed to fetch GitHub user')
  }

  return (await userResponse.json()) as {
    login: string
    id: number
  }
}

async function handleSignInFlow(params: {
  tokenData: TokenResponseData
  redirectTo: string
  cookieStore: CookieStore
}): Promise<Response> {
  const session = await createGitHubSession(params.tokenData.access_token, params.tokenData.scope)

  if (!session) {
    return new Response('Failed to create session', { status: 500 })
  }

  const response = new Response(null, {
    status: 302,
    headers: {
      Location: params.redirectTo,
    },
  })

  await saveSession(response, session)
  return response
}

async function handleConnectFlow(params: {
  tokenData: TokenResponseData
  githubUser: { login: string; id: number }
  storedUserId: string
}) {
  const encryptedToken = encrypt(params.tokenData.access_token)
  const existingAccount = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, 'github'), eq(accounts.externalUserId, `${params.githubUser.id}`)))
    .limit(1)

  if (existingAccount.length === 0) {
    await db.insert(accounts).values({
      id: nanoid(),
      userId: params.storedUserId,
      provider: 'github',
      externalUserId: `${params.githubUser.id}`,
      accessToken: encryptedToken,
      scope: params.tokenData.scope,
      username: params.githubUser.login,
    })
    return
  }

  const connectedUserId = existingAccount[0].userId

  if (connectedUserId !== params.storedUserId) {
    await transferUserResources({
      sourceUserId: connectedUserId,
      targetUserId: params.storedUserId,
    })

    await updateAccountOwnership({
      accountId: existingAccount[0].id,
      newUserId: params.storedUserId,
      encryptedToken,
      scope: params.tokenData.scope,
      username: params.githubUser.login,
    })

    await db.delete(users).where(eq(users.id, connectedUserId))
    return
  }

  await updateAccountToken({
    accountId: existingAccount[0].id,
    encryptedToken,
    scope: params.tokenData.scope,
    username: params.githubUser.login,
  })
}

async function transferUserResources(params: { sourceUserId: string; targetUserId: string }) {
  await db.update(tasks).set({ userId: params.targetUserId }).where(eq(tasks.userId, params.sourceUserId))
  await db.update(connectors).set({ userId: params.targetUserId }).where(eq(connectors.userId, params.sourceUserId))
  await db.update(accounts).set({ userId: params.targetUserId }).where(eq(accounts.userId, params.sourceUserId))
  await db.update(keys).set({ userId: params.targetUserId }).where(eq(keys.userId, params.sourceUserId))
}

async function updateAccountOwnership(params: {
  accountId: string
  newUserId: string
  encryptedToken: string
  scope: string
  username: string
}) {
  await db
    .update(accounts)
    .set({
      userId: params.newUserId,
      accessToken: params.encryptedToken,
      scope: params.scope,
      username: params.username,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, params.accountId))
}

async function updateAccountToken(params: {
  accountId: string
  encryptedToken: string
  scope: string
  username: string
}) {
  await db
    .update(accounts)
    .set({
      accessToken: params.encryptedToken,
      scope: params.scope,
      username: params.username,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, params.accountId))
}

function cleanupOAuthCookies(cookieStore: CookieStore, authMode: string | null) {
  if (authMode) {
    cookieStore.delete('github_auth_state')
    cookieStore.delete('github_auth_redirect_to')
    cookieStore.delete('github_auth_mode')
  } else {
    cookieStore.delete('github_oauth_state')
    cookieStore.delete('github_oauth_redirect_to')
  }

  cookieStore.delete('github_oauth_user_id')
}
