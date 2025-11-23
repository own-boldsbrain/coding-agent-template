import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { NextRequest } from 'next/server'

// Mock dependencies
const mockListPulls = vi.fn()
const mockOctokit = {
  auth: true,
  rest: {
    pulls: {
      list: mockListPulls,
    },
  },
}

vi.mock('@/lib/github/client', () => ({
  getOctokit: vi.fn().mockImplementation(async () => mockOctokit),
}))

describe('GET /api/repos/[owner]/[repo]/pull-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOctokit.auth = true
  })

  it('should return pull requests successfully', async () => {
    const mockPRs = [
      { id: 1, title: 'PR 1' },
      { id: 2, title: 'PR 2' },
    ]
    mockListPulls.mockResolvedValue({ data: mockPRs })

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/pull-requests')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pullRequests).toEqual(mockPRs)
    expect(mockListPulls).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      state: 'open',
      per_page: 30,
      sort: 'updated',
      direction: 'desc',
    })
  })

  it('should return 401 if not authenticated', async () => {
    mockOctokit.auth = false // Simulate no auth

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/pull-requests')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('GitHub authentication required')
  })

  it('should return 500 if GitHub API fails', async () => {
    mockListPulls.mockRejectedValue(new Error('GitHub API Error'))

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/pull-requests')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch pull requests')
  })
})
