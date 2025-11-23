import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

// Mock dependencies
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

vi.mock('arctic', () => ({
  generateState: vi.fn(() => 'mock-state'),
}))

vi.mock('@/lib/session/server', () => ({
  getSessionFromReq: vi.fn(),
}))

import { getSessionFromReq } from '@/lib/session/server'
import { cookies } from 'next/headers'

describe('GET /api/auth/signin/github', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, NEXT_PUBLIC_GITHUB_CLIENT_ID: 'gh-client-id' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should redirect with error if client id is missing', async () => {
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = ''
    vi.mocked(getSessionFromReq).mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/auth/signin/github')
    const response = await GET(req)

    expect(response.status).toBe(302) // Redirect
    expect(response.headers.get('Location')).toContain('error=github_not_configured')
  })

  it('should redirect to github auth url for signin', async () => {
    vi.mocked(getSessionFromReq).mockResolvedValue(undefined)

    const mockCookieStore = {
      set: vi.fn(),
    }
    vi.mocked(cookies).mockResolvedValue(mockCookieStore as any)

    const req = new NextRequest('http://localhost/api/auth/signin/github?next=/dashboard')
    const response = await GET(req)

    expect(response.status).toBe(302)
    const location = response.headers.get('Location')
    expect(location).toContain('github.com/login/oauth/authorize')
    expect(location).toContain('client_id=gh-client-id')
    expect(location).toContain('state=mock-state')

    expect(mockCookieStore.set).toHaveBeenCalledWith('github_auth_state', 'mock-state', expect.any(Object))
    expect(mockCookieStore.set).toHaveBeenCalledWith('github_auth_mode', 'signin', expect.any(Object))
    expect(mockCookieStore.set).toHaveBeenCalledWith('github_auth_redirect_to', '/dashboard', expect.any(Object))
  })

  it('should redirect to github auth url for connect', async () => {
    const mockSession = { user: { id: 'user-123' } }
    vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)

    const mockCookieStore = {
      set: vi.fn(),
    }
    vi.mocked(cookies).mockResolvedValue(mockCookieStore as any)

    const req = new NextRequest('http://localhost/api/auth/signin/github')
    const response = await GET(req)

    expect(response.status).toBe(302)

    expect(mockCookieStore.set).toHaveBeenCalledWith('github_auth_mode', 'connect', expect.any(Object))
    expect(mockCookieStore.set).toHaveBeenCalledWith('github_oauth_user_id', 'user-123', expect.any(Object))
  })
})
