/** @format */

import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { TaskRouteError, buildTaskRouteContext, handleTaskRouteError } from '../task-route-helpers'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const context = await buildTaskRouteContext({
      params,
      requireRepo: true,
      requireGitHubClient: true,
    })
    const octokit = context.octokit
    const repoInfo = context.repo
    const pullNumber = context.task.prNumber

    if (!octokit || !repoInfo || !pullNumber) {
      throw new TaskRouteError('Task does not have a pull request', 400)
    }

    await octokit.rest.pulls.update({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: pullNumber,
      state: 'closed',
    })

    await db
      .update(tasks)
      .set({
        prStatus: 'closed',
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, context.task.id))

    return NextResponse.json({
      success: true,
      message: 'Pull request closed successfully',
    })
  } catch (error) {
    return handleTaskRouteError(error, 'Failed to close pull request', {
      404: 'Pull request not found',
      403: 'Permission denied. Check repository access',
    })
  }
}
