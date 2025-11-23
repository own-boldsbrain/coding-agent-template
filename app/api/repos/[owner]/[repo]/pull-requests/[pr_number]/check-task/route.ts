import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { getServerSession } from '@/lib/session/get-server-session'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; pr_number: string }> },
) {
  try {
    // Get user session
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { owner, repo, pr_number } = await context.params
    const prNumber = Number.parseInt(pr_number, 10)

    if (Number.isNaN(prNumber)) {
      return NextResponse.json({ error: 'Invalid PR number' }, { status: 400 })
    }

    const repoUrl = `https://github.com/${owner}/${repo}`

    // Check if a task already exists for this PR and user
    const existingTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, session.user.id),
          eq(tasks.prNumber, prNumber),
          eq(tasks.repoUrl, repoUrl),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1)

    return NextResponse.json({
      hasTask: existingTasks.length > 0,
      taskId: existingTasks.length > 0 ? existingTasks[0].id : null,
    })
  } catch (error) {
    console.error('Error checking for existing task:', error)
    return NextResponse.json({ error: 'Failed to check for existing task' }, { status: 500 })
  }
}
