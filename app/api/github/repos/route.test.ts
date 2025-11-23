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

describe('GET /api/github/repos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 if no github token', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/github/repos')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'GitHub not connected' })
  })

  it('should return 400 if owner is missing', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue('gh-token')

    const req = new NextRequest('http://localhost/api/github/repos')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Owner parameter is required' })
  })

  it('should return repos for owner', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue('gh-token')

    // Mock user response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ login: 'testuser' }),
    } as Response)

    // Mock repos response (page 1)
    const mockRepos = [{ name: 'repo1', full_name: 'testuser/repo1', private: false }]
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockRepos,
    } as Response)

    // Mock repos response (page 2 - empty to stop loop)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response)

    const req = new NextRequest('http://localhost/api/github/repos?owner=testuser')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe('repo1')
  })
})
