import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { getOrReconnectSandbox } from '@/lib/sandbox/sandbox-registry'

export async function GET(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params

    // Get task from database and verify ownership (exclude soft-deleted)
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Check if task has a sandbox
    if (!task.sandboxId) {
      return NextResponse.json({ error: 'Task does not have an active sandbox' }, { status: 400 })
    }

    const sandbox = await getOrReconnectSandbox(taskId, task.sandboxId)

    if (!sandbox) {
      return NextResponse.json({ error: 'Sandbox not available' }, { status: 400 })
    }

    // With the new LSP integration running in the sandbox, we no longer need to
    // pre-load all project files into Monaco. The LSP has direct access to all
    // files and node_modules, and will handle type resolution on demand.
    //
    // This avoids the "too many open files" error that occurs when trying to
    // load hundreds of files simultaneously.
    return NextResponse.json({
      success: true,
      files: [],
    })
  } catch (error) {
    console.error('Error in project-files API:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
