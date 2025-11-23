/** @format */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

// Mock dependencies
vi.mock('@/lib/session/get-server-session', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  tasks: {
    id: 'id',
    userId: 'userId',
    deletedAt: 'deletedAt',
    createdAt: 'createdAt',
  },
}))

vi.mock('@/lib/github/user-token', () => ({
  getUserGitHubToken: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
}))

import { db } from '@/lib/db/client'
import { getServerSession } from '@/lib/session/get-server-session'

describe('GET /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 if user is not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
  })

  it('should return tasks for authenticated user', async () => {
    const mockSession = { user: { id: 'user-123' } }
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any)

    const mockTasks = [
      {
        id: 'task-1',
        title: 'Test Task',
        status: 'completed',
      },
    ]

    // Setup chainable mock for db
    const mockOrderBy = vi.fn().mockResolvedValue(mockTasks)
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

    vi.mocked(db.select).mockImplementation(mockSelect as any)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ tasks: mockTasks })
    expect(db.select).toHaveBeenCalled()
  })

  it('should return 500 if database query fails', async () => {
    const mockSession = { user: { id: 'user-123' } }
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any)

    vi.mocked(db.select).mockImplementation(() => {
      throw new Error('DB Error')
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch tasks' })
  })
})
