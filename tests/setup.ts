import { vi } from 'vitest'

const mockFetch = vi.fn((url) => {
  return Promise.resolve({
    json: () => Promise.resolve({}),
    ok: true,
    status: 200,
    statusText: 'OK',
  } as Response)
})

vi.stubGlobal('fetch', mockFetch)
