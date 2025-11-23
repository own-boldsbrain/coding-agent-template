/** @format */

import { Writable } from 'node:stream'
import { runCommandInSandbox, runInProject } from '@/lib/sandbox/commands'
import type { Sandbox } from '@/lib/sandbox'
import type { TaskLogger } from '@/lib/utils/task-logger'

export type PackageJson = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export type LoggerLike = Pick<TaskLogger, 'info'>

export function determineDevEnvironment(packageJson: PackageJson) {
  const hasVite = Boolean(packageJson?.dependencies?.vite || packageJson?.devDependencies?.vite)
  return {
    devPort: hasVite ? 5173 : 3000,
    hasVite,
  }
}

export async function terminateProcessOnPort(sandbox: Sandbox, port: number): Promise<void> {
  await runCommandInSandbox(sandbox, 'sh', ['-c', `lsof -ti:${port} | xargs -r kill -9 2>/dev/null || true`])
}

export async function buildDevCommandConfig({
  packageManager,
  packageJson,
  sandbox,
  hasVite,
  logger,
}: {
  packageManager: string
  packageJson: PackageJson
  sandbox: Sandbox
  hasVite: boolean
  logger: LoggerLike
}) {
  const devCommand = packageManager === 'npm' ? 'npm' : packageManager
  let devArgs = packageManager === 'npm' ? ['run', 'dev'] : ['dev']

  if (hasVite) {
    await configureViteSandboxOverrides(sandbox, logger)
    devArgs =
      packageManager === 'npm'
        ? ['run', 'dev', '--', '--config', 'vite.sandbox.config.js', '--host', '0.0.0.0']
        : ['dev', '--config', 'vite.sandbox.config.js', '--host', '0.0.0.0']
  }

  if (isNext16Project(packageJson)) {
    devArgs = packageManager === 'npm' ? ['run', 'dev', '--', '--webpack'] : ['dev', '--webpack']
  }

  return { devCommand, devArgs }
}

async function configureViteSandboxOverrides(sandbox: Sandbox, logger: LoggerLike): Promise<void> {
  const sandboxViteConfig = `import { defineConfig, mergeConfig } from 'vite'

let userConfig = {}
try {
  const importedConfig = await import('./vite.config.js')
  userConfig = importedConfig.default || {}
} catch {
}

export default mergeConfig(userConfig, defineConfig({
  server: {
    host: '0.0.0.0',
    strictPort: false,
    allowedHosts: undefined,
  }
}))`

  await runInProject(sandbox, 'sh', ['-c', `cat > vite.sandbox.config.js << 'VITEEOF'\n${sandboxViteConfig}\nVITEEOF`])
  await runCommandInSandbox(sandbox, 'sh', [
    '-c',
    'grep -q "vite.sandbox.config.js" ~/.gitignore_global 2>/dev/null || echo "vite.sandbox.config.js" >> ~/.gitignore_global',
  ])
  await runInProject(sandbox, 'git', ['config', 'core.excludesfile', '~/.gitignore_global'])
  await logger.info('Configured Vite sandbox overrides')
}

function isNext16Project(packageJson: PackageJson): boolean {
  const nextVersion = packageJson?.dependencies?.next || packageJson?.devDependencies?.next || ''
  return nextVersion.startsWith('16.') || nextVersion.startsWith('^16.') || nextVersion.startsWith('~16.')
}

export function createServerLogStreams(logger: LoggerLike) {
  const stdout = new Writable({
    write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      emitServerLogs(chunk, logger)
      callback()
    },
  })

  const stderr = new Writable({
    write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      emitServerLogs(chunk, logger, true)
      callback()
    },
  })

  return { stdout, stderr }
}

function emitServerLogs(chunk: Buffer | string, logger: LoggerLike, isError = false) {
  const lines = chunk
    .toString()
    .split('\n')
    .filter((line) => line.trim())

  if (lines.length === 0) {
    return
  }

  for (const line of lines) {
    if (isError) {
      console.error('[SERVER]', line)
    } else {
      console.log('[SERVER]', line)
    }
  }

  logger.info('Development server log entry received').catch(() => {})
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
