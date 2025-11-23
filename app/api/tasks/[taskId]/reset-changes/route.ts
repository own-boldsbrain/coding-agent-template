/** @format */

import { PROJECT_DIR } from "@/lib/sandbox/commands";
import { type NextRequest, NextResponse } from "next/server";
import {
  TaskRouteError,
  buildTaskRouteContext,
  getActiveSandbox,
  handleTaskRouteError,
} from "../task-route-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const context = await buildTaskRouteContext({ params });
    const { commitMessage } = await request.json();

    if (!context.task.branchName) {
      throw new TaskRouteError("Branch not available", 400);
    }

    const sandbox = await getActiveSandbox(
      context.task.id,
      context.task.sandboxId
    );
    const hadLocalChanges = await snapshotLocalChanges(sandbox, commitMessage);
    const resetTarget = await determineResetTarget(
      sandbox,
      context.task.branchName
    );

    await runGitCommandStrict(
      sandbox,
      ["reset", "--hard", resetTarget],
      "Failed to reset changes"
    );

    try {
      await runGitCommandStrict(
        sandbox,
        ["clean", "-fd"],
        "Failed to clean workspace"
      );
    } catch {
      // Cleaning failures are non-fatal
    }

    return NextResponse.json({
      success: true,
      message: "Changes reset successfully to match remote branch",
      hadLocalChanges,
    });
  } catch (error) {
    return handleTaskRouteError(
      error,
      "An error occurred while resetting changes",
      {
        410: "Sandbox is not running",
      }
    );
  }
}

type ActiveSandbox = Awaited<ReturnType<typeof getActiveSandbox>>;

async function snapshotLocalChanges(
  sandbox: ActiveSandbox,
  commitMessage?: string
) {
  const statusOutput = await runGitCommandStrict(
    sandbox,
    ["status", "--porcelain"],
    "Failed to check status"
  );
  const hasChanges = statusOutput.trim().length > 0;

  if (!hasChanges) {
    return false;
  }

  await runGitCommandStrict(sandbox, ["add", "."], "Failed to add changes");
  const message =
    typeof commitMessage === "string" && commitMessage.length > 0
      ? commitMessage
      : "Checkpoint before reset";
  await runGitCommandStrict(
    sandbox,
    ["commit", "-m", message],
    "Failed to commit changes"
  );

  return true;
}

async function determineResetTarget(
  sandbox: ActiveSandbox,
  branchName: string
) {
  const lsRemoteResult = await sandbox.runCommand({
    cmd: "git",
    args: ["ls-remote", "--heads", "origin", branchName],
    cwd: PROJECT_DIR,
  });

  if (lsRemoteResult.exitCode !== 0) {
    return "HEAD";
  }

  const lsRemoteOutput = await lsRemoteResult.stdout();
  const remoteBranchExists = lsRemoteOutput.trim().length > 0;

  if (!remoteBranchExists) {
    return "HEAD";
  }

  await runGitCommandStrict(
    sandbox,
    ["fetch", "origin", branchName],
    "Failed to fetch from remote"
  );
  return "FETCH_HEAD";
}

async function runGitCommandStrict(
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
    throw new TaskRouteError(errorMessage, 500);
  }

  try {
    return (await result.stdout()) || "";
  } catch {
    return "";
  }
}
