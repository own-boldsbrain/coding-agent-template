/** @format */

import { Sandbox } from "@/lib/sandbox";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildTaskRouteContext,
  handleTaskRouteError,
  type TaskRouteContext,
} from "../task-route-helpers";

type TaskRecord = TaskRouteContext["task"];
type SandboxHealthResponse = {
  status: string;
  message?: string;
  statusCode?: number;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const context = await buildTaskRouteContext({ params });
    const response = await evaluateSandboxHealth(context.task);
    return NextResponse.json(response);
  } catch (error) {
    return handleTaskRouteError(error, "Failed to check sandbox health");
  }
}

async function evaluateSandboxHealth(
  task: TaskRecord
): Promise<SandboxHealthResponse> {
  if (!task.sandboxId || !task.sandboxUrl) {
    return {
      status: "not_available",
      message: "Sandbox not created yet",
    };
  }

  try {
    const sandbox = await Sandbox.get({
      sandboxId: task.sandboxId,
    });

    if (!sandbox) {
      return {
        status: "stopped",
        message: "Sandbox has stopped or expired",
      };
    }

    return evaluateDevServer(task.sandboxUrl);
  } catch (error) {
    console.error("Sandbox.get() error:", error);
    return {
      status: "stopped",
      message: "Sandbox no longer exists",
    };
  }
}

async function evaluateDevServer(url: string): Promise<SandboxHealthResponse> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    return interpretDevServerResponse(response);
  } catch (error) {
    return mapFetchErrorToHealth(error);
  }
}

async function interpretDevServerResponse(
  response: Response
): Promise<SandboxHealthResponse> {
  const contentLength = response.headers.get("content-length");
  const body = await response.text();

  if (response.status === 200 && (contentLength === "0" || body.length === 0)) {
    return {
      status: "starting",
      message: "Dev server is starting up",
    };
  }

  if (response.ok && body.length > 0) {
    return {
      status: "running",
      message: "Sandbox and dev server are running",
    };
  }

  if (response.status === 410 || response.status === 502) {
    return {
      status: "stopped",
      message: "Sandbox has stopped or expired",
    };
  }

  if (response.status >= 500) {
    return {
      status: "error",
      message: "Dev server returned an error",
      statusCode: response.status,
    };
  }

  if (response.status === 404 || response.status === 503) {
    return {
      status: "starting",
      message: "Dev server is starting up",
    };
  }

  return {
    status: "starting",
    message: "Dev server is initializing",
  };
}

function mapFetchErrorToHealth(error: unknown): SandboxHealthResponse {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.message.includes("timeout"))
  ) {
    return {
      status: "starting",
      message: "Dev server is starting or not responding",
    };
  }

  if (error instanceof Error) {
    return {
      status: "stopped",
      message: "Cannot connect to sandbox",
    };
  }

  return {
    status: "starting",
    message: "Checking dev server status...",
  };
}
