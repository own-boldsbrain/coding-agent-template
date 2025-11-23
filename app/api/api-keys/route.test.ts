import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

// Mock dependencies
vi.mock('@/lib/session/server', () => ({
  getSessionFromReq: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  keys: {
    userId: 'userId',
    provider: 'provider',
    createdAt: 'createdAt',
    key: 'key',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}))

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((val) => `encrypted-${val}`),
  decrypt: vi.fn((val) => val.replace('encrypted-', '')),
}))

import { db } from '@/lib/db/client'
import { getSessionFromReq } from '@/lib/session/server'

describe('API Keys Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/api-keys', () => {
    it('should return 401 if user is not authenticated', async () => {
      vi.mocked(getSessionFromReq).mockResolvedValue(undefined)

      const req = new NextRequest('http://localhost/api/api-keys')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return api keys for authenticated user', async () => {
      const mockSession = { user: { id: 'user-123' } }
      vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)

      const mockKeys = [{ provider: 'openai', createdAt: new Date() }]

      // Setup chainable mock for db
      const mockWhere = vi.fn().mockResolvedValue(mockKeys)
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

      vi.mocked(db.select).mockImplementation(mockSelect as any)

      const req = new NextRequest('http://localhost/api/api-keys')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      // We need to serialize dates because response.json() does
      expect(JSON.stringify(data.apiKeys)).toEqual(JSON.stringify(mockKeys))
    })
  })

  describe('POST /api/api-keys', () => {
    it('should return 401 if user is not authenticated', async () => {
      vi.mocked(getSessionFromReq).mockResolvedValue(undefined)

      const req = new NextRequest('http://localhost/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-123' }),
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 if provider or apiKey is missing', async () => {
      const mockSession = { user: { id: 'user-123' } }
      vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)

      const req = new NextRequest('http://localhost/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({ provider: 'openai' }), // Missing apiKey
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Provider and API key are required' })
    })

    it('should save api key successfully', async () => {
      const mockSession = { user: { id: 'user-123' } }
      vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)

      const mockInsertedKey = { provider: 'openai', createdAt: new Date() }

      // Setup chainable mock for db select (check existing)
      const mockLimit = vi.fn().mockResolvedValue([]) // No existing key
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
      vi.mocked(db.select).mockImplementation(mockSelect as any)

      // Setup chainable mock for db insert
      const mockReturning = vi.fn().mockResolvedValue([mockInsertedKey])
      const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
      const mockInsert = vi.fn().mockReturnValue({ values: mockValues })

      vi.mocked(db.insert).mockImplementation(mockInsert as any)

      const req = new NextRequest('http://localhost/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-123' }),
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(db.insert).toHaveBeenCalled()
    })
  })
})
