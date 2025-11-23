import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fetch
globalThis.fetch = vi.fn()

describe('GET /api/github-stars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules() // Reset modules to clear cache
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should fetch stars from github', async () => {
    const { GET } = await import('./route')

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 1234 }),
    } as Response)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ stars: 1234 })
    expect(fetch).toHaveBeenCalled()
  })

  it('should return cached stars if fresh', async () => {
    const { GET } = await import('./route')

    // First call to populate cache
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 1234 }),
    } as Response)

    await GET()
    expect(fetch).toHaveBeenCalledTimes(1)

    // Advance time by 4 minutes (less than 5 min cache)
    vi.advanceTimersByTime(4 * 60 * 1000)

    // Second call should use cache
    const response = await GET()
    const data = await response.json()

    expect(data).toEqual({ stars: 1234 })
    expect(fetch).toHaveBeenCalledTimes(1) // Still 1 call
  })

  it('should refresh cache if expired', async () => {
    const { GET } = await import('./route')

    // First call to populate cache
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 1234 }),
    } as Response)

    await GET()
    expect(fetch).toHaveBeenCalledTimes(1)

    // Advance time by 6 minutes (more than 5 min cache)
    vi.advanceTimersByTime(6 * 60 * 1000)

    // Second call should fetch again
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 5678 }),
    } as Response)

    const response = await GET()
    const data = await response.json()

    expect(data).toEqual({ stars: 5678 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('should return fallback if fetch fails', async () => {
    const { GET } = await import('./route')

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
    } as Response)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('stars')
  })
})
