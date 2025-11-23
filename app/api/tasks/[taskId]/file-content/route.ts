/** @format */

import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { getOctokit } from '@/lib/github/client'
import { PROJECT_DIR } from '@/lib/sandbox/commands'
import { getServerSession } from '@/lib/session/get-server-session'
import type { Sandbox } from '@vercel/sandbox'
import type { Octokit } from '@octokit/rest'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

type TaskRecord = typeof tasks.$inferSelect

async function getOrReconnectSandbox(taskId: string, sandboxId: string): Promise<Sandbox | null> {
  const { getSandbox } = await import('@/lib/sandbox/sandbox-registry')
  const { Sandbox } = await import('@vercel/sandbox')

  const sandbox = getSandbox(taskId)
  if (sandbox) {
    return sandbox
  }

  const sandboxToken = process.env.SANDBOX_VERCEL_TOKEN
  const teamId = process.env.SANDBOX_VERCEL_TEAM_ID
  const projectId = process.env.SANDBOX_VERCEL_PROJECT_ID

  if (!sandboxToken || !teamId || !projectId) {
    return null
  }

  try {
    return await Sandbox.get({
      sandboxId,
      teamId,
      projectId,
      token: sandboxToken,
    })
  } catch (error) {
    console.error('Failed to reconnect to sandbox:', error)
    return null
  }
}

async function readFileFromSandbox(sandbox: Sandbox, filename: string): Promise<string | null> {
  try {
    const normalizedPath = filename.startsWith('/') ? filename.substring(1) : filename
    const catResult = await sandbox.runCommand({
      cmd: 'cat',
      args: [normalizedPath],
      cwd: PROJECT_DIR,
    })

    if (catResult.exitCode === 0) {
      return await catResult.stdout()
    }
  } catch (error) {
    console.error('Error reading file from sandbox:', error)
  }
  return null
}

function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const langMap: { [key: string]: string } = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    sql: 'sql',
  }
  return langMap[ext || ''] || 'text'
}

function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase()
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif']
  return imageExtensions.includes(ext || '')
}

function isBinaryFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase()
  const binaryExtensions = [
    // Archives
    'zip',
    'tar',
    'gz',
    'rar',
    '7z',
    'bz2',
    // Executables
    'exe',
    'dll',
    'so',
    'dylib',
    // Databases
    'db',
    'sqlite',
    'sqlite3',
    // Media (non-image)
    'mp3',
    'mp4',
    'avi',
    'mov',
    'wav',
    'flac',
    // Documents
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    // Fonts
    'ttf',
    'otf',
    'woff',
    'woff2',
    'eot',
    // Other binary
    'bin',
    'dat',
    'dmg',
    'iso',
    'img',
  ]
  return binaryExtensions.includes(ext || '') || isImageFile(filename)
}

async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  isImage: boolean,
): Promise<{ content: string; isBase64: boolean }> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    })

    if ('content' in response.data && typeof response.data.content === 'string') {
      // For images, return the base64 content as-is
      if (isImage) {
        return {
          content: response.data.content,
          isBase64: true,
        }
      }

      // For text files, decode from base64
      return {
        content: Buffer.from(response.data.content, 'base64').toString('utf-8'),
        isBase64: false,
      }
    }

    return { content: '', isBase64: false }
  } catch (error: unknown) {
    // File might not exist in this ref
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
      return { content: '', isBase64: false }
    }
    throw error
  }
}

async function getLocalModeContent(params: {
  taskId: string
  task: TaskRecord
  filename: string
  isImage: boolean
  isNodeModulesFile: boolean
  octokit: Octokit
  owner: string
  repo: string
  branchName: string
}): Promise<{ oldContent: string; newContent: string; isBase64: boolean }> {
  let oldContent = ''
  let isBase64 = false

  if (!params.isNodeModulesFile) {
    const remoteResult = await getFileContent(
      params.octokit,
      params.owner,
      params.repo,
      params.filename,
      params.branchName,
      params.isImage,
    )
    oldContent = remoteResult.content
    isBase64 = remoteResult.isBase64
  }

  let newContent = ''
  if (params.task.sandboxId) {
    const sandbox = await getOrReconnectSandbox(params.taskId, params.task.sandboxId)
    if (sandbox) {
      newContent = (await readFileFromSandbox(sandbox, params.filename)) || ''
    }
  }

  if (!newContent) {
    throw new Error('File not found in sandbox')
  }

  return { oldContent, newContent, isBase64 }
}

async function getRemoteModeContent(params: {
  taskId: string
  task: TaskRecord
  filename: string
  isImage: boolean
  isNodeModulesFile: boolean
  octokit: Octokit
  owner: string
  repo: string
  branchName: string
}): Promise<{ content: string; isBase64: boolean; fileFound: boolean }> {
  let content = ''
  let isBase64 = false
  let fileFound = false

  if (params.isNodeModulesFile && params.task.sandboxId) {
    const sandbox = await getOrReconnectSandbox(params.taskId, params.task.sandboxId)
    if (sandbox) {
      const result = await readFileFromSandbox(sandbox, params.filename)
      if (result) {
        content = result
        fileFound = true
      }
    }
  } else {
    const result = await getFileContent(
      params.octokit,
      params.owner,
      params.repo,
      params.filename,
      params.branchName,
      params.isImage,
    )
    content = result.content
    isBase64 = result.isBase64
    if (content || params.isImage) {
      fileFound = true
    }
  }

  if (!fileFound && !params.isImage && !params.isNodeModulesFile && params.task.sandboxId) {
    const sandbox = await getOrReconnectSandbox(params.taskId, params.task.sandboxId)
    if (sandbox) {
      const result = await readFileFromSandbox(sandbox, params.filename)
      if (result) {
        content = result
        fileFound = true
      }
    }
  }

  return { content, isBase64, fileFound }
}

async function validateAndParseRequest(request: NextRequest, taskId: string, userId: string) {
  const searchParams = request.nextUrl.searchParams
  const rawFilename = searchParams.get('filename')
  const mode = searchParams.get('mode') || 'remote'

  if (!rawFilename) {
    throw new Error('Missing filename parameter')
  }

  const filename = decodeURIComponent(rawFilename)

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1)

  if (!task) {
    throw new Error('Task not found')
  }

  if (!task.branchName || !task.repoUrl) {
    throw new Error('Task does not have branch or repository information')
  }

  const octokit = await getOctokit()
  if (!octokit.auth) {
    throw new Error('GitHub authentication required. Please connect your GitHub account to view files.')
  }

  const githubRegex = /github\.com\/([^/]+)\/([^/.]+)/
  const githubMatch = githubRegex.exec(task.repoUrl)
  if (!githubMatch) {
    throw new Error('Invalid GitHub repository URL')
  }

  const [, owner, repo] = githubMatch

  return { filename, mode, task, octokit, owner, repo }
}

async function processFileContent(params: {
  taskId: string
  task: TaskRecord
  filename: string
  mode: string
  octokit: Octokit
  owner: string
  repo: string
}): Promise<{
  filename: string
  oldContent: string
  newContent: string
  language: string
  isBinary: boolean
  isImage: boolean
  isBase64: boolean
}> {
  const isImage = isImageFile(params.filename)
  const isBinary = isBinaryFile(params.filename)

  if (isBinary && !isImage) {
    return {
      filename: params.filename,
      oldContent: '',
      newContent: '',
      language: 'text',
      isBinary: true,
      isImage: false,
      isBase64: false,
    }
  }

  const isNodeModulesFile = params.filename.includes('/node_modules/')
  let oldContent = ''
  let newContent = ''
  let isBase64 = false

  if (params.mode === 'local') {
    const result = await getLocalModeContent({
      taskId: params.taskId,
      task: params.task,
      filename: params.filename,
      isImage,
      isNodeModulesFile,
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      branchName: params.task.branchName,
    })
    oldContent = result.oldContent
    newContent = result.newContent
    isBase64 = result.isBase64
  } else {
    const result = await getRemoteModeContent({
      taskId: params.taskId,
      task: params.task,
      filename: params.filename,
      isImage,
      isNodeModulesFile,
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      branchName: params.task.branchName,
    })

    if (!result.fileFound && !isImage) {
      throw new Error('File not found in branch')
    }

    newContent = result.content
    isBase64 = result.isBase64
  }

  return {
    filename: params.filename,
    oldContent,
    newContent,
    language: getLanguageFromFilename(params.filename),
    isBinary: false,
    isImage,
    isBase64,
  }
}

function getStatusFromErrorMessage(message: string, defaultStatus: number): number {
  if (message.includes('Unauthorized') || message.includes('authentication')) {
    return 401
  }
  if (message.includes('not found')) {
    return 404
  }
  return defaultStatus
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await params

    let filename: string
    let mode: string
    let task: TaskRecord
    let octokit: Octokit
    let owner: string
    let repo: string

    try {
      const validated = await validateAndParseRequest(request, taskId, session.user.id)
      filename = validated.filename
      mode = validated.mode
      task = validated.task
      octokit = validated.octokit
      owner = validated.owner
      repo = validated.repo
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bad request'
      const status = getStatusFromErrorMessage(message, 400)
      return NextResponse.json({ error: message }, { status })
    }

    try {
      const data = await processFileContent({
        taskId,
        task,
        filename,
        mode,
        octokit,
        owner,
        repo,
      })

      return NextResponse.json({
        success: true,
        data,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch file content from GitHub'
      const status = getStatusFromErrorMessage(message, 500)
      console.error('Error fetching file content from GitHub:', error)
      return NextResponse.json({ error: message }, { status })
    }
  } catch (error) {
    console.error('Error in file-content API:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
