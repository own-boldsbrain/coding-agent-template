/** @format */

import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { getOctokit, parseGitHubUrl } from "@/lib/github/client";
import { getServerSession } from "@/lib/session/get-server-session";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

export class TaskRouteError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

interface BuildTaskRouteOptions {
  params: Promise<{ taskId: string }>;
  requireRepo?: boolean;
  requireGitHubClient?: boolean;
}

export interface TaskRouteContext {
  task: typeof tasks.$inferSelect;
  sessionUserId: string;
  repo?: {
    owner: string;
    repo: string;
  };
  octokit?: Awaited<ReturnType<typeof getOctokit>>;
}

export async function buildTaskRouteContext(
  options: BuildTaskRouteOptions
): Promise<TaskRouteContext> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    throw new TaskRouteError("Unauthorized", 401);
  }

  const { taskId } = await options.params;

  const [task] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.userId, session.user.id),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);

  if (!task) {
    throw new TaskRouteError("Task not found", 404);
  }

  const context: TaskRouteContext = {
    task,
    sessionUserId: session.user.id,
  };

  if (options.requireRepo) {
    if (!task.repoUrl || !task.prNumber) {
      throw new TaskRouteError("Task does not have a pull request", 400);
    }

    const parsedRepo = parseGitHubUrl(task.repoUrl);
    if (!parsedRepo) {
      throw new TaskRouteError("Invalid GitHub repository URL", 400);
    }

    context.repo = parsedRepo;
  }

  if (options.requireGitHubClient) {
    const octokit = await getOctokit();
    if (!octokit.auth) {
      throw new TaskRouteError(
        "GitHub authentication required. Please connect your GitHub account.",
        401
      );
    }
    context.octokit = octokit;
  }

  return context;
}

export function handleTaskRouteError(
  error: unknown,
  fallbackMessage: string,
  statusMessages?: Record<number, string>
) {
  if (error instanceof TaskRouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }

  if (statusMessages) {
    const [status, message] = findStatusMessage(error, statusMessages);
    if (status && message) {
      return NextResponse.json({ error: message }, { status });
    }
  }

  console.error("Task route error", error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function findStatusMessage(
  error: unknown,
  messages: Record<number, string>
): [number | null, string | null] {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: number }).status;
    if (status && messages[status]) {
      return [status, messages[status]];
    }
  }

  return [null, null];
}

export async function getActiveSandbox(
  taskId: string,
  sandboxId: string | null
) {
  if (!sandboxId) {
    throw new TaskRouteError("Sandbox not available", 400);
  }

  const { getSandbox } = await import("@/lib/sandbox/sandbox-registry");
  const { Sandbox } = await import("@vercel/sandbox");

  const existingSandbox = getSandbox(taskId);
  if (existingSandbox) {
    return existingSandbox;
  }

  const credentials = getSandboxCredentials();
  const sandbox = await Sandbox.get({
    sandboxId,
    ...credentials,
  });

  if (!sandbox) {
    throw new TaskRouteError("Sandbox not found or inactive", 400);
  }

  return sandbox;
}

function getSandboxCredentials() {
  const token = process.env.SANDBOX_VERCEL_TOKEN;
  const teamId = process.env.SANDBOX_VERCEL_TEAM_ID;
  const projectId = process.env.SANDBOX_VERCEL_PROJECT_ID;

  if (!token || !teamId || !projectId) {
    throw new TaskRouteError("Sandbox credentials not configured", 500);
  }

  return {
    token,
    teamId,
    projectId,
  };
}
