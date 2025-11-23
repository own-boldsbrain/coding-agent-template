import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

// Mock dependencies
vi.mock('@/lib/github/user-token', () => ({
  getUserGitHubToken: vi.fn(),
}))

// Mock fetch
global.fetch = vi.fn()

import { getUserGitHubToken } from '@/lib/github/user-token'

describe('GET /api/github/user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 if no github token', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/github/user')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'GitHub not connected' })
  })

  it('should return user data if token exists', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue('gh-token')

    const mockUser = {
      login: 'testuser',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
    }

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockUser,
    } as Response)

    const req = new NextRequest('http://localhost/api/github/user')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual(mockUser)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer gh-token',
        }),
      }),
    )
  })

  it('should return 500 if github api fails', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue('gh-token')

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    const req = new NextRequest('http://localhost/api/github/user')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch user data' })
  })
})
