import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { NextRequest } from 'next/server'

// Mock dependencies
const mockListCommits = vi.fn()
const mockOctokit = {
  auth: true,
  rest: {
    repos: {
      listCommits: mockListCommits,
    },
  },
}

vi.mock('@/lib/github/client', () => ({
  getOctokit: vi.fn().mockImplementation(async () => mockOctokit),
}))

describe('GET /api/repos/[owner]/[repo]/commits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOctokit.auth = true
  })

  it('should return commits successfully', async () => {
    const mockCommits = [
      { sha: '123', commit: { message: 'test commit' } },
      { sha: '456', commit: { message: 'another commit' } },
    ]
    mockListCommits.mockResolvedValue({ data: mockCommits })

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/commits')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.commits).toEqual(mockCommits)
    expect(mockListCommits).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      per_page: 30,
    })
  })

  it('should return 401 if not authenticated', async () => {
    mockOctokit.auth = false // Simulate no auth

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/commits')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('GitHub authentication required')
  })

  it('should return 500 if GitHub API fails', async () => {
    mockListCommits.mockRejectedValue(new Error('GitHub API Error'))

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/commits')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch commits')
  })
})
