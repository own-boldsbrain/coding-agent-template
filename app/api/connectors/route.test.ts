import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/session/server', () => ({
  getSessionFromReq: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  connectors: {
    userId: 'userId',
    oauthClientSecret: 'oauthClientSecret',
    env: 'env',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((val) => val.replace('encrypted-', '')),
}))

import { getSessionFromReq } from '@/lib/session/server'
import { db } from '@/lib/db/client'

describe('GET /api/connectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 if user is not authenticated', async () => {
    vi.mocked(getSessionFromReq).mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/connectors')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({
      success: false,
      error: 'Unauthorized',
      data: [],
    })
  })

  it('should return connectors for authenticated user', async () => {
    const mockSession = { user: { id: 'user-123' } }
    vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)

    const mockConnectors = [
      {
        id: 'conn-1',
        oauthClientSecret: 'encrypted-secret',
        env: 'encrypted-{"key":"value"}',
      },
    ]

    // Setup chainable mock for db
    const mockWhere = vi.fn().mockResolvedValue(mockConnectors)
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

    vi.mocked(db.select).mockImplementation(mockSelect as any)

    const req = new NextRequest('http://localhost/api/connectors')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data).toHaveLength(1)
    expect(data.data[0].oauthClientSecret).toBe('secret')
    expect(data.data[0].env).toEqual({ key: 'value' })
  })

  it('should return 500 if database query fails', async () => {
    const mockSession = { user: { id: 'user-123' } }
    vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)

    vi.mocked(db.select).mockImplementation(() => {
      throw new Error('DB Error')
    })

    const req = new NextRequest('http://localhost/api/connectors')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({
      success: false,
      error: 'Failed to fetch connectors',
      data: [],
    })
  })
})
