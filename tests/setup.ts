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

// Mock ResizeObserver
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
