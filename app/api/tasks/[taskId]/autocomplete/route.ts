/** @format */

import { type NextRequest, NextResponse } from 'next/server'
import { TaskRouteError, buildTaskRouteContext, getActiveSandbox, handleTaskRouteError } from '../task-route-helpers'

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const context = await buildTaskRouteContext({ params })
    const { partial, cwd } = await request.json()

    if (typeof partial !== 'string') {
      throw new TaskRouteError('Partial text is required', 400)
    }

    const sandbox = await getActiveSandbox(context.task.id, context.task.sandboxId)
    const workingDirectory = await resolveWorkingDirectory(sandbox, cwd)
    const completionContext = parseCompletionContext(partial, workingDirectory)
    const listing = await listDirectoryEntries(sandbox, completionContext.dir)
    const completions = filterCompletions(listing, completionContext.prefix)

    return NextResponse.json({
      success: true,
      data: {
        completions,
        prefix: completionContext.prefix,
      },
    })
  } catch (error) {
    return handleTaskRouteError(error, 'Failed to get completions', {
      400: 'Sandbox not available',
    })
  }
}

type ActiveSandbox = Awaited<ReturnType<typeof getActiveSandbox>>

async function resolveWorkingDirectory(sandbox: ActiveSandbox, requestCwd = '/home/vercel-sandbox') {
  const fallbackDir = requestCwd

  try {
    const pwdResult = await sandbox.runCommand('sh', ['-c', 'pwd'])
    const output = await pwdResult.stdout()
    return output?.trim() || fallbackDir
  } catch {
    return fallbackDir
  }
}

function parseCompletionContext(partial: string, currentDirectory: string) {
  const parts = partial.split(/\s+/)
  const lastPart = parts.at(-1) || ''
  let dir = currentDirectory
  let prefix = ''

  if (lastPart.includes('/')) {
    const lastSlash = lastPart.lastIndexOf('/')
    const pathPart = lastPart.substring(0, lastSlash + 1)
    prefix = lastPart.substring(lastSlash + 1)

    if (pathPart.startsWith('/')) {
      dir = pathPart
    } else if (pathPart.startsWith('~/')) {
      dir = `/home/vercel-sandbox/${pathPart.substring(2)}`
    } else {
      dir = `${currentDirectory}/${pathPart}`
    }
  } else {
    prefix = lastPart
  }

  return { dir, prefix }
}

async function listDirectoryEntries(sandbox: ActiveSandbox, directory: string) {
  const escapedDir = escapeDirectoryPath(directory)
  const lsCommand = `cd ${escapedDir} 2>/dev/null && ls -1ap 2>/dev/null || echo ''`
  const result = await sandbox.runCommand('sh', ['-c', lsCommand])

  try {
    return (await result.stdout()) || ''
  } catch {
    return ''
  }
}

function filterCompletions(listing: string, prefix: string) {
  if (!listing) {
    return []
  }

  const normalizedPrefix = prefix.toLowerCase()

  return listing
    .trim()
    .split('\n')
    .filter((entry) => entry.toLowerCase().startsWith(normalizedPrefix))
    .map((entry) => ({
      name: entry,
      isDirectory: entry.endsWith('/'),
    }))
}

function escapeDirectoryPath(directory: string) {
  const escapeSequence = String.raw`"`
  return `"${directory.replaceAll('"', escapeSequence)}"`
}
