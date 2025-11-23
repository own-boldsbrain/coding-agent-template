/** @format */

import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { Sandbox } from '@/lib/sandbox'
import { getServerSession } from '@/lib/session/get-server-session'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

type TaskRecord = typeof tasks.$inferSelect
type SandboxHealthResponse = {
  status: string
  message?: string
  statusCode?: number
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params
    const taskRecord = await loadUserTask(taskId, session.user.id)
    if (!taskRecord) {
      return NextResponse.json({ status: 'not_found' })
    }

    const response = await evaluateSandboxHealth(taskRecord)
    return NextResponse.json(response)
  } catch (error) {
    console.error('Error checking sandbox health:', error)
    return NextResponse.json({
      status: 'error',
      message: 'Failed to check sandbox health',
    })
  }
}

async function loadUserTask(taskId: string, userId: string): Promise<TaskRecord | null> {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1)

  if (!task || task.length === 0) {
    return null
  }

  return task[0]
}

async function evaluateSandboxHealth(task: TaskRecord): Promise<SandboxHealthResponse> {
  if (!task.sandboxId || !task.sandboxUrl) {
    return {
      status: 'not_available',
      message: 'Sandbox not created yet',
    }
  }

  try {
    const sandbox = await Sandbox.get({
      sandboxId: task.sandboxId,
    })

    if (!sandbox) {
      return {
        status: 'stopped',
        message: 'Sandbox has stopped or expired',
      }
    }

    return evaluateDevServer(task.sandboxUrl)
  } catch (error) {
    console.error('Sandbox.get() error:', error)
    return {
      status: 'stopped',
      message: 'Sandbox no longer exists',
    }
  }
}

async function evaluateDevServer(url: string): Promise<SandboxHealthResponse> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    return interpretDevServerResponse(response)
  } catch (error) {
    return mapFetchErrorToHealth(error)
  }
}

async function interpretDevServerResponse(response: Response): Promise<SandboxHealthResponse> {
  const contentLength = response.headers.get('content-length')
  const body = await response.text()

  if (response.status === 200 && (contentLength === '0' || body.length === 0)) {
    return {
      status: 'starting',
      message: 'Dev server is starting up',
    }
  }

  if (response.ok && body.length > 0) {
    return {
      status: 'running',
      message: 'Sandbox and dev server are running',
    }
  }

  if (response.status === 410 || response.status === 502) {
    return {
      status: 'stopped',
      message: 'Sandbox has stopped or expired',
    }
  }

  if (response.status >= 500) {
    return {
      status: 'error',
      message: 'Dev server returned an error',
      statusCode: response.status,
    }
  }

  if (response.status === 404 || response.status === 503) {
    return {
      status: 'starting',
      message: 'Dev server is starting up',
    }
  }

  return {
    status: 'starting',
    message: 'Dev server is initializing',
  }
}

function mapFetchErrorToHealth(error: unknown): SandboxHealthResponse {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.message.includes('timeout'))) {
    return {
      status: 'starting',
      message: 'Dev server is starting or not responding',
    }
  }

  if (error instanceof Error) {
    return {
      status: 'stopped',
      message: 'Cannot connect to sandbox',
    }
  }

  return {
    status: 'starting',
    message: 'Checking dev server status...',
  }
}
