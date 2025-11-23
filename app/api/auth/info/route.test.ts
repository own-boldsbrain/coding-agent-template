import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

// Mock dependencies
vi.mock('@/lib/session/server', () => ({
  getSessionFromReq: vi.fn(),
}))

vi.mock('@/lib/session/create-github', () => ({
  saveSession: vi.fn(),
}))

import { saveSession } from '@/lib/session/create-github'
import { getSessionFromReq } from '@/lib/session/server'

describe('GET /api/auth/info', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return user info if session exists', async () => {
    const mockSession = { user: { id: 'user-123', name: 'Test User' } }
    vi.mocked(getSessionFromReq).mockResolvedValue(mockSession as any)

    const req = new NextRequest('http://localhost/api/auth/info')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ user: mockSession.user })
    expect(saveSession).toHaveBeenCalled()
  })

  it('should return undefined user if no session exists', async () => {
    vi.mocked(getSessionFromReq).mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/auth/info')
    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ user: undefined })
    expect(saveSession).toHaveBeenCalled()
  })
})
