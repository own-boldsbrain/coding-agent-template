/** @format */

import { PROJECT_DIR } from '@/lib/sandbox/commands'
import { type NextRequest, NextResponse } from 'next/server'
import { TaskRouteError, buildTaskRouteContext, getActiveSandbox, handleTaskRouteError } from '../task-route-helpers'

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const context = await buildTaskRouteContext({ params })
    const { filename } = await request.json()

    if (!filename || typeof filename !== 'string') {
      throw new TaskRouteError('Missing filename parameter', 400)
    }

    const sandbox = await getActiveSandbox(context.task.id, context.task.sandboxId)
    const isTracked = await isFileTracked(sandbox, filename)

    if (isTracked) {
      await revertTrackedFile(sandbox, filename)
    } else {
      await deleteUntrackedFile(sandbox, filename)
    }

    return NextResponse.json({
      success: true,
      message: isTracked ? 'Changes discarded successfully' : 'New file deleted successfully',
    })
  } catch (error) {
    return handleTaskRouteError(error, 'An error occurred while discarding changes', {
      410: 'Sandbox is not running',
    })
  }
}

type ActiveSandbox = Awaited<ReturnType<typeof getActiveSandbox>>

async function isFileTracked(sandbox: ActiveSandbox, filename: string) {
  const lsFilesResult = await sandbox.runCommand({
    cmd: 'git',
    args: ['ls-files', filename],
    cwd: PROJECT_DIR,
  })

  const content = await lsFilesResult.stdout()
  return content.trim().length > 0
}

async function revertTrackedFile(sandbox: ActiveSandbox, filename: string) {
  const checkoutResult = await sandbox.runCommand({
    cmd: 'git',
    args: ['checkout', 'HEAD', '--', filename],
    cwd: PROJECT_DIR,
  })

  if (checkoutResult.exitCode !== 0) {
    throw new TaskRouteError('Failed to discard changes', 500)
  }
}

async function deleteUntrackedFile(sandbox: ActiveSandbox, filename: string) {
  const rmResult = await sandbox.runCommand({
    cmd: 'rm',
    args: [filename],
    cwd: PROJECT_DIR,
  })

  if (rmResult.exitCode !== 0) {
    throw new TaskRouteError('Failed to delete file', 500)
  }
}
