import { exec } from 'child_process'
import { promisify } from 'util'
import { randomBytes } from 'crypto'

const execAsync = promisify(exec)

export interface DockerSandboxConfig {
  teamId: string
  projectId: string
  token: string
  timeout?: number
  ports?: number[]
  runtime?: string
  resources?: { vcpus: number }
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  output: string
  success: boolean
  error?: string
}

export class DockerSandbox {
  private containerId: string | null = null
  private containerName: string
  private imageName = 'coding-agent-sandbox:latest'
  public client: any
  public routes: any
  public sandboxId: string
  public status: string

  constructor(private config: DockerSandboxConfig) {
    this.containerName = `sandbox-${randomBytes(8).toString('hex')}`
    this.sandboxId = this.containerName
    this.client = null // Docker client not needed for local sandbox
    this.routes = null // Routes not applicable for local sandbox
    this.status = 'running'
  }

  static async create(config: DockerSandboxConfig): Promise<DockerSandbox> {
    const sandbox = new DockerSandbox(config)
    await sandbox.initialize()
    return sandbox
  }

  private async initialize() {
    try {
      // Build image if it does not exist
      await this.ensureImage()

      // Create and start container
      const portMappings = (this.config.ports || [3000]).map((p) => `-p ${p}:${p}`).join(' ')

      const { stdout } = await execAsync(
        `docker run -d ${portMappings} --name ${this.containerName} ` +
          `--add-host=host.docker.internal:host-gateway ` +
          `-e OLLAMA_HOST=http://host.docker.internal:11434 ` +
          `-w /workspace ` +
          `${this.imageName} tail -f /dev/null`,
      )

      this.containerId = stdout.trim()
    } catch (error: any) {
      throw new Error(`Failed to create Docker sandbox: ${error.message}`)
    }
  }

  private async ensureImage() {
    try {
      await execAsync(`docker inspect ${this.imageName}`)
    } catch {
      // Image does not exist, build from inline Dockerfile
      console.log('Building Docker sandbox image...')

      const dockerfile = `
FROM node:22-slim

RUN apt-get update && apt-get install -y \\
    git \\
    python3 \\
    python3-pip \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir requests --break-system-packages

WORKDIR /workspace

CMD ["/bin/bash"]
`

      // Create temp Dockerfile
      const tempDockerfile = `C:\\Users\\fjuni\\coding-agent-template\\Dockerfile.sandbox`
      require('fs').writeFileSync(tempDockerfile, dockerfile)

      await execAsync(`docker build -t ${this.imageName} -f ${tempDockerfile} .`)

      // Clean up temp file
      require('fs').unlinkSync(tempDockerfile)
    }
  }

  get commands() {
    return {
      run: async (options: { command: string; args?: string[] }): Promise<CommandResult> => {
        if (!this.containerId) {
          throw new Error('Sandbox not initialized')
        }

        try {
          const cmd =
            options.args && options.args.length > 0 ? `${options.command} ${options.args.join(' ')}` : options.command

          const { stdout, stderr } = await execAsync(`docker exec ${this.containerId} sh -c ${JSON.stringify(cmd)}`)

          return {
            exitCode: 0,
            stdout: stdout,
            stderr: stderr,
            output: stdout,
            success: true,
          }
        } catch (error: any) {
          return {
            exitCode: error.code || 1,
            stdout: error.stdout || '',
            stderr: error.stderr || '',
            output: error.stdout || '',
            success: false,
            error: error.message,
          }
        }
      },
    }
  }

  async runCommand(command: string, args: string[] = []) {
    const result = await this.commands.run({ command, args })
    return {
      exitCode: result.exitCode,
      stdout: async () => result.stdout,
      stderr: async () => result.stderr,
    }
  }

  async cleanup() {
    if (this.containerId) {
      try {
        await execAsync(`docker rm -f ${this.containerId}`)
      } catch (error) {
        console.error('Failed to cleanup container:', error)
      }
    }
  }

  async shutdown() {
    await this.cleanup()
  }

  async stop() {
    this.status = 'stopped'
    await this.cleanup()
  }

  // Additional Sandbox interface methods
  get sandbox() {
    return this
  }

  getCommand() {
    return this.commands
  }

  _runCommand() {
    return this.runCommand.bind(this)
  }

  async mkDir(path: string) {
    return await this.runCommand('mkdir', ['-p', path])
  }

  async readFile(path: string) {
    const result = await this.runCommand('cat', [path])
    const stdout = await result.stdout()
    return stdout
  }

  async writeFiles(files: { path: string; content: string }[]) {
    for (const file of files) {
      const result = await this.runCommand('sh', ['-c', `cat > "${file.path}" << 'EOF'\n${file.content}\nEOF`])
      if (result.exitCode !== 0) {
        const stderr = await result.stderr()
        throw new Error(`Failed to write file ${file.path}: ${stderr}`)
      }
    }
  }

  get domain() {
    return `localhost:${this.config.ports?.[0] || 3000}`
  }
}
