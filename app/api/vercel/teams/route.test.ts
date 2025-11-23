import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /api/vercel/teams', () => {
  it('should return 410 Gone', async () => {
    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(410)
    expect(data).toEqual({ error: 'Vercel teams endpoint has been removed.' })
  })
})
