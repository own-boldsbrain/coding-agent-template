import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { PROJECT_DIR } from '@/lib/sandbox/commands'
import { getOrReconnectSandbox } from '@/lib/sandbox/sandbox-registry'
import { getServerSession } from '@/lib/session/get-server-session'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params
    const body = await request.json()
    const { foldername } = body

    if (!foldername || typeof foldername !== 'string') {
      return NextResponse.json({ success: false, error: 'Foldername is required' }, { status: 400 })
    }

    // Get task from database and verify ownership (exclude soft-deleted)
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)

    if (!task) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    }

    if (!task.sandboxId) {
      return NextResponse.json({ success: false, error: 'Sandbox not available' }, { status: 400 })
    }

    const sandbox = await getOrReconnectSandbox(taskId, task.sandboxId)

    if (!sandbox) {
      return NextResponse.json({ success: false, error: 'Sandbox not found or inactive' }, { status: 400 })
    }

    // Create the folder using mkdir -p
    const mkdirResult = await sandbox.runCommand({
      cmd: 'mkdir',
      args: ['-p', foldername],
      cwd: PROJECT_DIR,
    })

    if (mkdirResult.exitCode !== 0) {
      const stderr = await mkdirResult.stderr()
      console.error('Failed to create folder:', stderr)
      return NextResponse.json({ success: false, error: 'Failed to create folder' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Folder created successfully',
      foldername,
    })
  } catch (error) {
    console.error('Error creating folder:', error)

    // Check if it's a 410 error (sandbox not running)
    if (error && typeof error === 'object' && 'status' in error && error.status === 410) {
      return NextResponse.json(
        {
          success: false,
          error: 'Sandbox is not running',
        },
        { status: 410 },
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: 'An error occurred while creating the folder',
      },
      { status: 500 },
    )
  }
}
