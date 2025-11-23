/** @format */

import { posix as path } from 'node:path'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { PROJECT_DIR } from '@/lib/sandbox/commands'
import { getServerSession } from '@/lib/session/get-server-session'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

type OperationType = 'copy' | 'cut'

type FileOperationPayload = {
  operation: OperationType
  sourceFile: string
  targetPath?: string
}

type OperationHandler = {
  cmd: string
  buildArgs: (source: string, target: string) => string[]
  successMessage: string
  errorMessage: string
}

const OPERATION_HANDLERS: Record<OperationType, OperationHandler> = {
  copy: {
    cmd: 'cp',
    buildArgs: (source, target) => ['-r', source, target],
    successMessage: 'File copied successfully',
    errorMessage: 'Failed to copy file',
  },
  cut: {
    cmd: 'mv',
    buildArgs: (source, target) => [source, target],
    successMessage: 'File moved successfully',
    errorMessage: 'Failed to move file',
  },
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params
    const payload = await parseRequestPayload(request)
    if (!payload) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 })
    }

    const task = await findUserTask(taskId, session.user.id)
    if (!task) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    }

    if (!task.sandboxId) {
      return NextResponse.json({ success: false, error: 'Sandbox not available' }, { status: 400 })
    }

    const { getOrReconnectSandbox } = await import('@/lib/sandbox/sandbox-registry')
    const sandbox = await getOrReconnectSandbox(taskId, task.sandboxId)
    if (!sandbox) {
      return NextResponse.json({ success: false, error: 'Sandbox not found' }, { status: 404 })
    }

    const handler = OPERATION_HANDLERS[payload.operation]
    const targetFile = buildTargetFile(payload.sourceFile, payload.targetPath)
    const commandResult = await sandbox.runCommand({
      cmd: handler.cmd,
      args: handler.buildArgs(payload.sourceFile, targetFile),
      cwd: PROJECT_DIR,
    })

    if (commandResult.exitCode !== 0) {
      console.error('File operation command failed')
      return NextResponse.json({ success: false, error: handler.errorMessage }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: handler.successMessage,
    })
  } catch (error) {
    console.error('Error performing file operation:', error)
    return NextResponse.json({ success: false, error: 'Failed to perform file operation' }, { status: 500 })
  }
}

async function findUserTask(taskId: string, userId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1)

  return task
}

async function parseRequestPayload(request: NextRequest): Promise<FileOperationPayload | null> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') {
      return null
    }

    const { operation, sourceFile, targetPath } = body as Record<string, unknown>
    if (!isValidOperation(operation) || typeof sourceFile !== 'string' || !sourceFile.trim()) {
      return null
    }

    const normalizedSource = sourceFile.trim()
    if (!isSafeRelativePath(normalizedSource)) {
      return null
    }

    if (targetPath && typeof targetPath !== 'string') {
      return null
    }

    const normalizedTarget = typeof targetPath === 'string' && targetPath.trim() ? targetPath.trim() : undefined
    if (normalizedTarget && !isSafeRelativePath(normalizedTarget)) {
      return null
    }

    return {
      operation,
      sourceFile: normalizedSource,
      targetPath: normalizedTarget,
    }
  } catch {
    return null
  }
}

function isValidOperation(value: unknown): value is OperationType {
  return value === 'copy' || value === 'cut'
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith('/')) {
    return false
  }
  return !value.split('/').includes('..')
}

function buildTargetFile(sourceFile: string, targetPath?: string): string {
  const sourceBasename = path.basename(sourceFile)
  if (!targetPath || targetPath === '.') {
    return sourceBasename
  }
  return path.join(targetPath, sourceBasename)
}
