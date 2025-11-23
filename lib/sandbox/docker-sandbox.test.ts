import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DockerSandbox } from './docker-sandbox'
import { exec } from 'node:child_process'

vi.mock('node:child_process', () => {
  const exec = vi.fn()
  const spawn = vi.fn()
  return {
    exec,
    spawn,
    default: {
      exec,
      spawn,
    },
  }
})

vi.mock('node:fs/promises', () => ({
  default: {
    mkdtemp: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
  },
}))

describe('DockerSandbox', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should create a sandbox instance', async () => {
    const execMock = exec as unknown as ReturnType<typeof vi.fn>

    execMock.mockImplementation((command, options, callback) => {
      if (typeof options === 'function') {
        callback = options
      }

      if (command.includes('docker image inspect')) {
        callback(null, { stdout: '[]', stderr: '' })
      } else if (command.includes('docker run')) {
        callback(null, { stdout: 'test-container-id\n', stderr: '' })
      } else {
        callback(null, { stdout: '', stderr: '' })
      }
    })

    const sandbox = await DockerSandbox.create({
      ports: [3000],
    })

    expect(sandbox).toBeDefined()
    expect(sandbox.sandboxId).toBeDefined()
    expect(execMock).toHaveBeenCalledWith(expect.stringContaining('docker run'), expect.anything(), expect.anything())
  })
})
