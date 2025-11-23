import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

// Mock dependencies
const mockListForRepo = vi.fn()
const mockOctokit = {
  auth: true,
  rest: {
    issues: {
      listForRepo: mockListForRepo,
    },
  },
}

vi.mock('@/lib/github/client', () => ({
  getOctokit: vi.fn().mockImplementation(async () => mockOctokit),
}))

describe('GET /api/repos/[owner]/[repo]/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOctokit.auth = true
  })

  it('should return issues successfully and filter out PRs', async () => {
    const mockIssues = [
      { id: 1, title: 'Issue 1', pull_request: undefined },
      { id: 2, title: 'PR 1', pull_request: {} }, // This is a PR
      { id: 3, title: 'Issue 2', pull_request: undefined },
    ]
    mockListForRepo.mockResolvedValue({ data: mockIssues })

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/issues')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.issues).toHaveLength(2)
    expect(data.issues).toEqual([
      { id: 1, title: 'Issue 1', pull_request: undefined },
      { id: 3, title: 'Issue 2', pull_request: undefined },
    ])
    expect(mockListForRepo).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      state: 'open',
      per_page: 30,
    })
  })

  it('should return 401 if not authenticated', async () => {
    mockOctokit.auth = false // Simulate no auth

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/issues')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('GitHub authentication required')
  })

  it('should return 500 if GitHub API fails', async () => {
    mockListForRepo.mockRejectedValue(new Error('GitHub API Error'))

    const req = new NextRequest('http://localhost:3000/api/repos/test-owner/test-repo/issues')
    const params = Promise.resolve({ owner: 'test-owner', repo: 'test-repo' })

    const response = await GET(req, { params })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch issues')
  })
})
