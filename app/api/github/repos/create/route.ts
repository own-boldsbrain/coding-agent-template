/** @format */

import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";
import { Octokit } from "@octokit/rest";
import { NextResponse } from "next/server";

interface RepoTemplate {
  id: string;
  name: string;
  description: string;
  cloneUrl?: string;
  image?: string;
}

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Helper function to recursively copy files from a directory
async function copyFilesRecursively(
  octokit: Octokit,
  sourceOwner: string,
  sourceRepoName: string,
  sourcePath: string,
  repoOwner: string,
  repoName: string,
  basePath: string
) {
  try {
    const contents = await fetchDirectoryContents(
      octokit,
      sourceOwner,
      sourceRepoName,
      sourcePath
    );

    if (!Array.isArray(contents)) {
      return;
    }

    for (const item of contents) {
      await handleContentItem({
        item,
        octokit,
        sourceOwner,
        sourceRepoName,
        repoOwner,
        repoName,
        basePath,
      });
    }
  } catch (error) {
    console.error("Error processing directory:", error);
  }
}

async function fetchDirectoryContents(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string
) {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
  });

  return data;
}

async function handleContentItem(params: {
  item: {
    type?: string;
    download_url?: string | null;
    path: string;
    name: string;
  };
  octokit: Octokit;
  sourceOwner: string;
  sourceRepoName: string;
  repoOwner: string;
  repoName: string;
  basePath: string;
}) {
  if (params.item.type === "file" && params.item.download_url) {
    await copyFileItem({
      ...params,
      item: {
        download_url: params.item.download_url,
        path: params.item.path,
        name: params.item.name,
      },
    });
    return;
  }

  if (params.item.type === "dir") {
    await copyFilesRecursively(
      params.octokit,
      params.sourceOwner,
      params.sourceRepoName,
      params.item.path,
      params.repoOwner,
      params.repoName,
      params.basePath
    );
  }
}

async function copyFileItem(params: {
  item: { download_url: string; path: string; name: string };
  octokit: Octokit;
  repoOwner: string;
  repoName: string;
  basePath: string;
}) {
  try {
    const response = await fetch(params.item.download_url);
    if (!response.ok) {
      throw new Error("Failed to fetch template file");
    }

    const content = await response.text();
    const relativePath = getRelativePath(
      params.item.path,
      params.basePath,
      params.item.name
    );

    await params.octokit.repos.createOrUpdateFileContents({
      owner: params.repoOwner,
      repo: params.repoName,
      path: relativePath,
      message: `Add ${relativePath} from template`,
      content: Buffer.from(content).toString("base64"),
    });
  } catch (error) {
    console.error("Error copying file", error);
  }
}

function getRelativePath(path: string, basePath: string, fallbackName: string) {
  if (!basePath) {
    return path;
  }

  return path.startsWith(`${basePath}/`)
    ? path.substring(basePath.length + 1)
    : fallbackName;
}

// Helper function to copy files from template repository
async function populateRepoFromTemplate(
  octokit: Octokit,
  repoOwner: string,
  repoName: string,
  template: RepoTemplate
) {
  if (!template.cloneUrl) {
    return;
  }

  // Parse clone URL to get owner and repo name
  const cloneMatch = /github\.com\/([\w-]+)\/([\w-]+?)(?:\.git)?$/.exec(
    template.cloneUrl
  );
  if (!cloneMatch) {
    throw new Error("Invalid clone URL");
  }

  const [, sourceOwner, sourceRepoName] = cloneMatch;

  try {
    // Get all files from the root of the template repository
    await copyFilesRecursively(
      octokit,
      sourceOwner,
      sourceRepoName,
      "", // Root path
      repoOwner,
      repoName,
      "" // Root path
    );
  } catch (error) {
    console.error("Error populating repository from template", error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      throw new HttpError("Unauthorized", 401);
    }

    const token = await getUserGitHubToken();
    if (!token) {
      throw new HttpError(
        "GitHub token not found. Please reconnect your GitHub account.",
        401
      );
    }

    const payload = await parseCreateRepoBody(request);
    const octokit = new Octokit({ auth: token });
    const repo = await createRepository(octokit, payload);

    await attemptTemplatePopulation(
      octokit,
      repo.data.owner.login,
      repo.data.name,
      payload.template
    );

    return NextResponse.json({
      success: true,
      name: repo.data.name,
      full_name: repo.data.full_name,
      clone_url: repo.data.clone_url,
      html_url: repo.data.html_url,
      private: repo.data.private,
    });
  } catch (error) {
    const handledResponse = handleRepoCreationError(error);
    if (handledResponse) {
      return handledResponse;
    }

    console.error("Error creating repository", error);
    return NextResponse.json(
      { error: "Failed to create repository" },
      { status: 500 }
    );
  }
}

async function attemptTemplatePopulation(
  octokit: Octokit,
  repoOwner: string,
  repoName: string,
  template?: RepoTemplate
) {
  if (!template) {
    return;
  }

  try {
    await populateRepoFromTemplate(octokit, repoOwner, repoName, template);
  } catch (error) {
    console.error("Error populating repository from template", error);
  }
}

async function parseCreateRepoBody(request: Request) {
  const body = await request.json();
  const { name, description, private: isPrivate, owner, template } = body;

  if (!name || typeof name !== "string") {
    throw new HttpError("Repository name is required", 400);
  }

  const repoNamePattern = /^[a-zA-Z0-9._-]+$/;
  if (!repoNamePattern.test(name)) {
    throw new HttpError(
      "Repository name can only contain alphanumeric characters, periods, hyphens, and underscores",
      400
    );
  }

  return {
    name,
    description: typeof description === "string" ? description : undefined,
    private: Boolean(isPrivate),
    owner: typeof owner === "string" ? owner : undefined,
    template: template as RepoTemplate | undefined,
  };
}

async function createRepository(
  octokit: Octokit,
  payload: Awaited<ReturnType<typeof parseCreateRepoBody>>
) {
  const repoDescription = payload.description || undefined;
  const isPrivate = payload.private || false;

  if (!payload.owner) {
    return octokit.repos.createForAuthenticatedUser({
      name: payload.name,
      description: repoDescription,
      private: isPrivate,
      auto_init: true,
    });
  }

  const { data: user } = await octokit.users.getAuthenticated();
  if (user.login === payload.owner) {
    return octokit.repos.createForAuthenticatedUser({
      name: payload.name,
      description: repoDescription,
      private: isPrivate,
      auto_init: true,
    });
  }

  try {
    return await octokit.repos.createInOrg({
      org: payload.owner,
      name: payload.name,
      description: repoDescription,
      private: isPrivate,
      auto_init: true,
    });
  } catch (error) {
    if (isGitHubError(error, 404)) {
      throw new HttpError(
        "Organization not found or you do not have permission to create repositories",
        403
      );
    }

    throw error;
  }
}

function handleRepoCreationError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }

  if (isGitHubError(error, 422)) {
    return NextResponse.json(
      { error: "Repository already exists or name is invalid" },
      { status: 422 }
    );
  }

  if (isGitHubError(error, 403)) {
    return NextResponse.json(
      {
        error:
          "You do not have permission to create repositories in this organization",
      },
      { status: 403 }
    );
  }

  return null;
}

function isGitHubError(error: unknown, status: number) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      (error as { status: number }).status === status
  );
}
