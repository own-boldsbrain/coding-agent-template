import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/session/server', () => ({
  getSessionFromReq: vi.fn(),
}))

vi.mock('@/lib/session/create-github', () => ({
  saveSession: vi.fn(),
}))

vi.mock('@/lib/session/get-oauth-token', () => ({
  getOAuthToken: vi.fn(),
}))

// Mock fetch
globalThis.fetch = vi.fn()

import { getSessionFromReq } from '@/lib/session/server'
import { saveSession } from '@/lib/session/create-github'
import { getOAuthToken } from '@/lib/session/get-oauth-token'

describe('GET /api/auth/signout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = 'gh-client-id'
    process.env.GITHUB_CLIENT_SECRET = 'gh-client-secret'
  })

  it('should sign out and revoke token if session exists', async () => {
    const mockSession = { user: { id: 'user-123' } }
    vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)
    vi.mocked(getOAuthToken).mockResolvedValue({ accessToken: 'gh-token' } as any)
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    const req = new NextRequest('http://localhost/api/auth/signout')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.url).toBe('/')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/applications/gh-client-id/token',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ access_token: 'gh-token' }),
      }),
    )
    expect(saveSession).toHaveBeenCalledWith(expect.any(Response), undefined)
  })

  it('should sign out even if no session', async () => {
    vi.mocked(getSessionFromReq).mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/auth/signout')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.url).toBe('/')

    expect(fetch).not.toHaveBeenCalled()
    expect(saveSession).toHaveBeenCalledWith(expect.any(Response), undefined)
  })

  it('should handle token revocation failure gracefully', async () => {
    const mockSession = { user: { id: 'user-123' } }
    vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)
    vi.mocked(getOAuthToken).mockResolvedValue({ accessToken: 'gh-token' } as any)
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

    const req = new NextRequest('http://localhost/api/auth/signout')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.url).toBe('/')

    expect(saveSession).toHaveBeenCalledWith(expect.any(Response), undefined)
  })
})
