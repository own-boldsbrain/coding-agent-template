import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

// Mock dependencies
vi.mock('@/lib/github/user-token', () => ({
  getUserGitHubToken: vi.fn(),
}))

// Mock fetch
globalThis.fetch = vi.fn()

import { getUserGitHubToken } from '@/lib/github/user-token'

describe('GET /api/github/orgs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 if no github token', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/github/orgs')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'GitHub not connected' })
  })

  it('should return orgs if token exists', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue('gh-token')

    const mockOrgs = [
      { login: 'org1', name: 'Organization 1', avatar_url: 'url1' },
      { login: 'org2', avatar_url: 'url2' }, // No name
    ]

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockOrgs,
    } as Response)

    const req = new NextRequest('http://localhost/api/github/orgs')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveLength(2)
    expect(data[0]).toEqual(mockOrgs[0])
    expect(data[1].name).toBe('org2') // Fallback to login
  })

  it('should return 500 if github api fails', async () => {
    vi.mocked(getUserGitHubToken).mockResolvedValue('gh-token')

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    const req = new NextRequest('http://localhost/api/github/orgs')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch organizations' })
  })
})
