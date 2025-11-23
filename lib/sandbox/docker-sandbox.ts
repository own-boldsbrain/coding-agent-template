import { type ChildProcess, exec, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Writable } from 'node:stream'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const SINGLE_QUOTE_ESCAPE = String.raw`'\''`

process.env.SANDBOX_VERCEL_TEAM_ID ??= 'docker-local'
process.env.SANDBOX_VERCEL_PROJECT_ID ??= 'docker-local'
process.env.SANDBOX_VERCEL_TOKEN ??= 'docker-local'

const IMAGE_NAME = 'coding-agent-sandbox:latest'
const IDENT_LABEL = 'coding-agent-template'
const CONFIG_LABEL = 'coding-agent-template.config'
const WORKSPACE_DIR = '/workspace'
const PROJECT_DIR = '/workspace/project'

type SandboxSourceConfig =
  | string
  | {
      type: 'git'
      url: string
      revision?: string
      depth?: number
    }

interface NormalizedSourceConfig {
  url: string
  revision?: string
  depth?: number
}

export interface DockerSandboxConfig {
  teamId?: string
  projectId?: string
  token?: string
  timeout?: number
  ports?: number[]
  runtime?: string
  resources?: { vcpus?: number }
  taskId?: string
  source?: SandboxSourceConfig
}

interface RunCommandOptions {
  cmd: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  detached?: boolean
  stdout?: Writable
  stderr?: Writable
  sudo?: boolean
}

interface RunCommandResult {
  exitCode: number
  success: boolean
  stdout: () => Promise<string>
  stderr: () => Promise<string>
}

interface InspectResult {
  Id: string
  Name: string
  Config?: {
    Labels?: Record<string, string>
  }
  State?: {
    Status?: string
  }
}

function escapeArg(arg: string): string {
  if (!arg) return ''
  return `'${arg.split(`'`).join(SINGLE_QUOTE_ESCAPE)}'`
}

export class DockerSandbox {
  private static readonly instances = new Map<string, DockerSandbox>()
  private static imagePromise: Promise<void> | null = null

  private containerId: string | null = null
  private timeoutHandle?: NodeJS.Timeout
  private readonly ports: number[]
  private workspaceVolume: string
  private cacheVolume: string
  private readonly detachedProcesses = new Set<ChildProcess>()

  public client: null = null
  public routes: null = null
  public sandboxId: string
  public status = 'running'

  constructor(private readonly config: DockerSandboxConfig & { id?: string }) {
    this.ports = config.ports && config.ports.length > 0 ? config.ports : [3000, 5173]
    const baseId = config.id || `sandbox-${randomBytes(8).toString('hex')}`
    this.sandboxId = baseId
    this.workspaceVolume = `${baseId}-workspace`
    this.cacheVolume = `${baseId}-cache`
  }

  static async create(config: DockerSandboxConfig): Promise<DockerSandbox> {
    await DockerSandbox.ensureImage()
    const sandbox = new DockerSandbox(config)
    await sandbox.initialize()
    DockerSandbox.instances.set(sandbox.sandboxId, sandbox)
    return sandbox
  }

  static async get(params: { sandboxId: string } & Record<string, unknown>): Promise<DockerSandbox> {
    const existing = DockerSandbox.instances.get(params.sandboxId)
    if (existing) {
      return existing
    }

    const inspect = await DockerSandbox.inspectContainer(params.sandboxId)
    if (!inspect) {
      throw new Error('Sandbox not found')
    }

    let parsedConfig: { ports: number[]; workspaceVolume: string; cacheVolume: string } = {
      ports: [3000, 5173],
      workspaceVolume: `${params.sandboxId}-workspace`,
      cacheVolume: `${params.sandboxId}-cache`,
    }

    const label = inspect.Config?.Labels?.[CONFIG_LABEL]
    if (label) {
      try {
        parsedConfig = JSON.parse(Buffer.from(label, 'base64').toString('utf8'))
      } catch {
        // Ignore parse errors and fall back to defaults
      }
    }

    const sandbox = new DockerSandbox({ id: params.sandboxId, ports: parsedConfig.ports })
    sandbox.workspaceVolume = parsedConfig.workspaceVolume
    sandbox.cacheVolume = parsedConfig.cacheVolume
    sandbox.containerId = inspect.Id
    sandbox.status = inspect.State?.Status || 'running'
    DockerSandbox.instances.set(sandbox.sandboxId, sandbox)
    return sandbox
  }

  private static async inspectContainer(name: string): Promise<InspectResult | null> {
    try {
      const { stdout } = await execAsync(`docker inspect ${name}`)
      const parsed: InspectResult[] = JSON.parse(stdout)
      return parsed[0] ?? null
    } catch {
      return null
    }
  }

  private static async ensureImage() {
    if (DockerSandbox.imagePromise) {
      await DockerSandbox.imagePromise
      return
    }

    DockerSandbox.imagePromise = (async () => {
      try {
        await execAsync(`docker image inspect ${IMAGE_NAME}`)
      } catch {
        console.log('Building Docker sandbox image...')

        const dockerfile = `
FROM node:22-slim

RUN apt-get update && apt-get install -y \\
    git \\
    python3 \\
    python3-pip \\
    curl \\
    unzip \\
    ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir requests --break-system-packages

WORKDIR /workspace

ENV SHELL=/bin/bash

CMD ["/bin/bash"]
`

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coding-agent-sandbox-'))
        const dockerfilePath = path.join(tempDir, 'Dockerfile')
        await fs.writeFile(dockerfilePath, dockerfile, 'utf8')
        try {
          await execAsync(`docker build -t ${IMAGE_NAME} -f "${dockerfilePath}" .`, {
            maxBuffer: 1024 * 1024 * 20,
          })
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true })
        }
      }
    })()

    await DockerSandbox.imagePromise
  }

  private async initialize() {
    try {
      await execAsync(`docker volume create ${this.workspaceVolume}`)
      await execAsync(`docker volume create ${this.cacheVolume}`)

      const portFlags = this.ports.map((port) => `-p ${port}:${port}`).join(' ')
      const encodedConfig = Buffer.from(
        JSON.stringify({
          ports: this.ports,
          workspaceVolume: this.workspaceVolume,
          cacheVolume: this.cacheVolume,
        }),
      ).toString('base64')

      const { stdout } = await execAsync(
        `docker run -d ${portFlags} --name ${this.sandboxId} --add-host=host.docker.internal:host-gateway -e OLLAMA_HOST=http://host.docker.internal:11434 -v ${this.workspaceVolume}:/workspace -v ${this.cacheVolume}:/workspace/.cache --label ${IDENT_LABEL}=true --label ${CONFIG_LABEL}=${encodedConfig} -w /workspace ${IMAGE_NAME} tail -f /dev/null`,
        { maxBuffer: 1024 * 1024 },
      )

      this.containerId = stdout.trim()

      await this.setupSource()

      if (this.config.timeout && this.config.timeout > 0) {
        this.timeoutHandle = setTimeout(() => {
          this.stop().catch(() => {
            // ignore
          })
        }, this.config.timeout)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to create Docker sandbox: ${message}`)
    }
  }

  private async setupSource() {
    if (!this.config.source) {
      return
    }

    await this.prepareProjectDirectory()
    const normalizedSource = this.normalizeSource(this.config.source)
    await this.cloneRepository(normalizedSource)
  }

  private normalizeSource(source: SandboxSourceConfig): NormalizedSourceConfig {
    if (typeof source === 'string') {
      return { url: source }
    }

    if (source.type === 'git') {
      return { url: source.url, revision: source.revision, depth: source.depth }
    }

    throw new Error('Unsupported sandbox source configuration')
  }

  private async prepareProjectDirectory() {
    await this.runCommand('rm', ['-rf', PROJECT_DIR])
    await this.runCommand('mkdir', ['-p', PROJECT_DIR])
  }

  private buildCloneArgs(source: NormalizedSourceConfig): string[] {
    return [
      'clone',
      ...(source.depth && source.depth > 0 ? ['--depth', source.depth.toString(), '--single-branch'] : []),
      ...(source.revision ? ['--branch', source.revision] : []),
      source.url,
      PROJECT_DIR,
    ]
  }

  private async cloneRepository(source: NormalizedSourceConfig) {
    const cloneResult = await this.runCommand({ cmd: 'git', args: this.buildCloneArgs(source), cwd: WORKSPACE_DIR })
    if (!cloneResult.success) {
      const stderr = await this.safeReadStream(cloneResult.stderr)
      throw new Error(this.buildErrorMessage('Failed to clone source repository', stderr))
    }

    if (source.revision && (!source.depth || source.depth <= 0)) {
      const checkoutResult = await this.runCommand({
        cmd: 'git',
        args: ['checkout', source.revision],
        cwd: PROJECT_DIR,
      })
      if (!checkoutResult.success) {
        const stderr = await this.safeReadStream(checkoutResult.stderr)
        throw new Error(this.buildErrorMessage('Failed to checkout revision', stderr))
      }
    }

    await this.runCommand('git', ['config', '--global', '--add', 'safe.directory', PROJECT_DIR]).catch(() => {})
  }

  private async safeReadStream(streamGetter?: () => Promise<string>): Promise<string> {
    if (!streamGetter) {
      return ''
    }

    try {
      return await streamGetter()
    } catch {
      return ''
    }
  }

  private buildErrorMessage(base: string, detail?: string) {
    const trimmedDetail = detail?.trim()
    if (trimmedDetail) {
      return `${base}: ${trimmedDetail}`
    }
    return base
  }

  private buildExecArgs(options: RunCommandOptions): string[] {
    const args: string[] = ['exec']

    if (!options.detached) {
      args.push('-i')
    }

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`)
      }
    }

    args.push(this.sandboxId)

    if (options.cwd) {
      this.appendCwdCommand(args, options)
    } else {
      this.appendDirectCommand(args, options)
    }

    return args
  }

  private appendCwdCommand(args: string[], options: RunCommandOptions) {
    const joinedArgs = (options.args || []).map((arg) => escapeArg(arg)).join(' ')
    const command = options.args && options.args.length > 0 ? `${options.cmd} ${joinedArgs}` : options.cmd
    const sudoCommand = options.sudo ? `sudo ${command}` : command
    const shellCommand = `cd ${options.cwd} && ${sudoCommand}`
    args.push('sh', '-c', shellCommand)
  }

  private appendDirectCommand(args: string[], options: RunCommandOptions) {
    if (options.sudo) {
      args.push('sudo')
    }
    args.push(options.cmd)
    if (options.args && options.args.length > 0) {
      args.push(...options.args)
    }
  }

  async runCommand(command: string, args?: string[]): Promise<RunCommandResult>
  async runCommand(options: RunCommandOptions): Promise<RunCommandResult>
  async runCommand(
    commandOrOptions: string | RunCommandOptions,
    positionalArgs: string[] = [],
  ): Promise<RunCommandResult> {
    if (!this.containerId) {
      throw new Error('Sandbox not initialized')
    }

    const options: RunCommandOptions =
      typeof commandOrOptions === 'string' ? { cmd: commandOrOptions, args: positionalArgs } : commandOrOptions

    const dockerArgs = this.buildExecArgs(options)

    if (options.detached) {
      return this.runDetachedCommand(dockerArgs, options)
    }

    return this.runForegroundCommand(dockerArgs, options)
  }

  private runForegroundCommand(dockerArgs: string[], options: RunCommandOptions): Promise<RunCommandResult> {
    return new Promise((resolve) => {
      const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

      let stdout = ''
      let stderr = ''

      if (child.stdout) {
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk
          if (options.stdout) {
            options.stdout.write(chunk)
          }
        })
      }

      if (child.stderr) {
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk
          if (options.stderr) {
            options.stderr.write(chunk)
          }
        })
      }

      child.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          success: (code ?? 1) === 0,
          stdout: async () => stdout,
          stderr: async () => stderr,
        })
      })

      child.on('error', (error) => {
        stderr += error.message
      })
    })
  }

  private runDetachedCommand(dockerArgs: string[], options: RunCommandOptions): Promise<RunCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
      this.detachedProcesses.add(child)

      if (child.stdout && options.stdout) {
        child.stdout.pipe(options.stdout, { end: false })
      }

      if (child.stderr && options.stderr) {
        child.stderr.pipe(options.stderr, { end: false })
      }

      let settled = false
      const cleanup = () => {
        if (child.stdout && options.stdout) {
          child.stdout.unpipe(options.stdout)
        }
        if (child.stderr && options.stderr) {
          child.stderr.unpipe(options.stderr)
        }
      }

      const finish = (result: RunCommandResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const timer = setTimeout(() => {
        finish({
          exitCode: 0,
          success: true,
          stdout: async () => '',
          stderr: async () => '',
        })
      }, 500)

      child.on('error', (error) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (settled) return
        if (code && code !== 0) {
          settled = true
          cleanup()
          reject(new Error(`Detached command exited with code ${code}`))
          return
        }
        finish({
          exitCode: code ?? 0,
          success: (code ?? 0) === 0,
          stdout: async () => '',
          stderr: async () => '',
        })
      })
    })
  }

  async stop() {
    this.status = 'stopped'
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = undefined
    }

    await this.cleanup()
    DockerSandbox.instances.delete(this.sandboxId)
  }

  async cleanup() {
    for (const child of this.detachedProcesses) {
      child.removeAllListeners()
    }
    this.detachedProcesses.clear()

    if (this.containerId) {
      try {
        await execAsync(`docker rm -f ${this.sandboxId}`)
      } catch (error) {
        console.error('Failed to cleanup container:', error)
      }
      this.containerId = null
    }

    await execAsync(`docker volume rm -f ${this.workspaceVolume}`).catch(() => {})
    await execAsync(`docker volume rm -f ${this.cacheVolume}`).catch(() => {})
  }

  domain(port?: number) {
    const targetPort = port || this.ports[0] || 3000
    return `http://localhost:${targetPort}`
  }
}
