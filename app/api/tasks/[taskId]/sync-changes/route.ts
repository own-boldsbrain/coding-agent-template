/** @format */

import { PROJECT_DIR } from "@/lib/sandbox/commands";
import { NextResponse } from "next/server";
import {
  TaskRouteError,
  buildTaskRouteContext,
  getActiveSandbox,
  handleTaskRouteError,
  type TaskRouteContext,
} from "../task-route-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const context = await buildTaskRouteContext({ params });
    const { commitMessage } = await parseRequestBody(request);
    const { sandbox, branchName } = await resolveSandbox(context);

    await addAllChanges(sandbox);
    const hasChanges = await checkForPendingChanges(sandbox);

    if (!hasChanges) {
      return NextResponse.json({
        success: true,
        message: "No changes to sync",
        committed: false,
        pushed: false,
      });
    }

    await commitChanges(sandbox, commitMessage);
    await pushChanges(sandbox, branchName);

    return NextResponse.json({
      success: true,
      message: "Changes synced successfully",
      committed: true,
      pushed: true,
    });
  } catch (error) {
    return handleTaskRouteError(
      error,
      "An error occurred while syncing changes",
      {
        410: "Sandbox is not running",
      }
    );
  }
}

type ActiveSandbox = Awaited<ReturnType<typeof getActiveSandbox>>;

async function resolveSandbox(context: TaskRouteContext) {
  const { task } = context;

  if (!task.sandboxId) {
    throw new TaskRouteError("Sandbox not available", 400);
  }

  if (!task.branchName) {
    throw new TaskRouteError("Branch not available", 400);
  }

  const sandbox = await getActiveSandbox(task.id, task.sandboxId);
  return { sandbox, branchName: task.branchName };
}

async function parseRequestBody(
  request: Request
): Promise<{ commitMessage?: string }> {
  try {
    const body = await request.json();
    return typeof body === "object" && body ? body : {};
  } catch {
    return {};
  }
}

async function addAllChanges(sandbox: ActiveSandbox) {
  await runGitCommand(sandbox, ["add", "."], "Failed to add changes");
}

async function checkForPendingChanges(sandbox: ActiveSandbox) {
  const result = await runGitCommand(
    sandbox,
    ["status", "--porcelain"],
    "Failed to check status"
  );
  const output = await result.stdout();
  return output.trim().length > 0;
}

async function commitChanges(sandbox: ActiveSandbox, commitMessage?: string) {
  const message = commitMessage?.trim() || "Sync local changes";
  await runGitCommand(
    sandbox,
    ["commit", "-m", message],
    "Failed to commit changes"
  );
}

async function pushChanges(sandbox: ActiveSandbox, branchName: string) {
  await runGitCommand(
    sandbox,
    ["push", "origin", branchName],
    "Failed to push changes"
  );
}

async function runGitCommand(
  sandbox: ActiveSandbox,
  args: string[],
  errorMessage: string
) {
  const result = await sandbox.runCommand({
    cmd: "git",
    args,
    cwd: PROJECT_DIR,
  });

  if (result.exitCode !== 0) {
    await logGitError(result);
    throw new TaskRouteError(errorMessage, 500);
  }

  return result;
}

async function logGitError(
  result: Awaited<ReturnType<ActiveSandbox["runCommand"]>>
) {
  try {
    const stderr = await result.stderr();
    console.error("Sync changes git command failed", stderr);
  } catch (error) {
    console.error("Sync changes git stderr unavailable", error);
  }
}
