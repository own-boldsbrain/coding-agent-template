/** @format */

import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { mergePullRequest } from "@/lib/github/client";
import { unregisterSandbox } from "@/lib/sandbox/sandbox-registry";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildTaskRouteContext,
  getActiveSandbox,
  handleTaskRouteError,
} from "../task-route-helpers";

interface RouteParams {
  params: Promise<{
    taskId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await buildTaskRouteContext({ params, requireRepo: true });
    const { task } = context;
    const {
      commitTitle,
      commitMessage,
      mergeMethod = "squash",
    } = await request.json();

    // Merge the pull request
    const result = await mergePullRequest({
      repoUrl: task.repoUrl,
      prNumber: task.prNumber,
      commitTitle,
      commitMessage,
      mergeMethod,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to merge pull request" },
        { status: 500 }
      );
    }

    // Stop the sandbox if it exists
    if (task.sandboxId) {
      try {
        const sandbox = await getActiveSandbox(task.id, task.sandboxId);
        await sandbox.stop();
        unregisterSandbox(task.id);
      } catch (sandboxError) {
        // Log error but don't fail the merge
        console.error("Error stopping sandbox after merge:", sandboxError);
      }
    }

    // Update task to mark PR as merged, store merge commit SHA, clear sandbox info, and set completedAt
    await db
      .update(tasks)
      .set({
        prStatus: "merged",
        prMergeCommitSha: result.sha || null,
        sandboxId: null,
        sandboxUrl: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));

    return NextResponse.json({
      success: true,
      data: {
        merged: result.merged,
        message: result.message,
        sha: result.sha,
      },
    });
  } catch (error) {
    return handleTaskRouteError(error, "Failed to merge pull request");
  }
}
