/** @format */

import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { Sandbox } from "@/lib/sandbox";
import {
  PROJECT_DIR,
  runCommandInSandbox,
  runInProject,
} from "@/lib/sandbox/commands";
import {
  buildDevCommandConfig,
  createServerLogStreams,
  delay,
  determineDevEnvironment,
  type PackageJson,
  terminateProcessOnPort,
} from "@/lib/sandbox/dev-server";
import { detectPackageManager } from "@/lib/sandbox/package-manager";
import { getServerSession } from "@/lib/session/get-server-session";
import { createTaskLogger } from "@/lib/utils/task-logger";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

type TaskRecord = typeof tasks.$inferSelect;
type TaskLoggerInstance = ReturnType<typeof createTaskLogger>;

class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Request failed");
    this.status = status;
    this.body = body;
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      throw new HttpError(401, { error: "Unauthorized" });
    }

    const { taskId } = await params;
    const task = await findTaskForUser(taskId, session.user.id);
    const sandbox = await getActiveSandbox(task);
    const logger = createTaskLogger(taskId);
    const packageJson = await readPackageJsonOrThrow(sandbox);

    await restartDevServer(sandbox, packageJson, logger);

    return NextResponse.json({
      success: true,
      message: "Dev server restarted successfully",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

function handleRouteError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(error.body, { status: error.status });
  }

  console.error("Error restarting dev server:", error);
  return NextResponse.json(
    {
      error: "Failed to restart dev server",
      details: error instanceof Error ? error.message : "Unknown error",
    },
    { status: 500 }
  );
}

async function findTaskForUser(
  taskId: string,
  userId: string
): Promise<TaskRecord> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) {
    throw new HttpError(404, { error: "Task not found" });
  }

  if (task.userId !== userId) {
    throw new HttpError(403, { error: "Unauthorized" });
  }

  return task;
}

async function getActiveSandbox(task: TaskRecord): Promise<Sandbox> {
  if (!task.sandboxId) {
    throw new HttpError(400, { error: "Sandbox is not active" });
  }

  return Sandbox.get({
    sandboxId: task.sandboxId,
  });
}

async function readPackageJsonOrThrow(sandbox: Sandbox): Promise<PackageJson> {
  const packageJsonCheck = await runInProject(sandbox, "test", [
    "-f",
    "package.json",
  ]);
  if (!packageJsonCheck.success) {
    throw new HttpError(400, { error: "No package.json found in sandbox" });
  }

  const packageJsonRead = await runCommandInSandbox(sandbox, "sh", [
    "-c",
    `cd ${PROJECT_DIR} && cat package.json`,
  ]);
  if (!packageJsonRead.success || !packageJsonRead.output) {
    throw new HttpError(500, { error: "Could not read package.json" });
  }

  const packageJson = JSON.parse(packageJsonRead.output) as PackageJson;
  if (!packageJson?.scripts?.dev) {
    throw new HttpError(400, { error: "No dev script found in package.json" });
  }

  return packageJson;
}

async function restartDevServer(
  sandbox: Sandbox,
  packageJson: PackageJson,
  logger: TaskLoggerInstance
): Promise<void> {
  const { devPort, hasVite } = determineDevEnvironment(packageJson);
  await terminateProcessOnPort(sandbox, devPort);
  await delay(1000);

  const packageManager = await detectPackageManager(sandbox, logger);
  const { devCommand, devArgs } = await buildDevCommandConfig({
    packageManager,
    packageJson,
    sandbox,
    hasVite,
    logger,
  });

  const fullDevCommand =
    devArgs.length > 0 ? `${devCommand} ${devArgs.join(" ")}` : devCommand;
  const { stdout, stderr } = createServerLogStreams(logger);

  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", `cd ${PROJECT_DIR} && ${fullDevCommand}`],
    detached: true,
    stdout,
    stderr,
  });

  await logger.info("Development server restarted");
}
