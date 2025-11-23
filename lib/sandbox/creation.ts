/** @format */

import { Writable } from 'node:stream'
import { generateId } from '@/lib/utils/id'
import { redactSensitiveInfo } from '@/lib/utils/logging'
import type { TaskLogger } from '@/lib/utils/task-logger'
import { PROJECT_DIR, runCommandInSandbox, runInProject } from './commands'
import { createAuthenticatedRepoUrl, validateEnvironmentVariables } from './config'
import { Sandbox } from './index'
import { detectPackageManager, installDependencies } from './package-manager'
import { registerSandbox } from './sandbox-registry'
import type { SandboxConfig, SandboxResult } from './types'

// Helper function to run command and log it
async function runAndLogCommand(sandbox: Sandbox, command: string, args: string[], logger: TaskLogger, cwd?: string) {
  // Properly escape arguments for shell execution
  const escapeArg = (arg: string) => {
    // Escape single quotes by replacing ' with '\''
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  const fullCommand = args.length > 0 ? `${command} ${args.map(escapeArg).join(' ')}` : command
  const redactedCommand = redactSensitiveInfo(fullCommand)

  await logger.command(redactedCommand)

  let result
  if (cwd) {
    // Run command in specific directory
    const cdCommand = `cd ${cwd} && ${fullCommand}`
    result = await runCommandInSandbox(sandbox, 'sh', ['-c', cdCommand])
  } else {
    result = await runCommandInSandbox(sandbox, command, args)
  }

  if (result?.output?.trim()) {
    const redactedOutput = redactSensitiveInfo(result.output.trim())
    await logger.info(redactedOutput)
  }

  if (result && !result.success && result.error) {
    const redactedError = redactSensitiveInfo(result.error)
    await logger.error(redactedError)
  }

  return result
}

type CancellationStage =
  | 'beforeSandboxCreation'
  | 'afterSandboxCreation'
  | 'afterDependencyInstallation'
  | 'beforeGitConfiguration'

const CANCELLATION_MESSAGES: Record<CancellationStage, string> = {
  beforeSandboxCreation: 'Task was cancelled before sandbox creation',
  afterSandboxCreation: 'Task was cancelled after sandbox creation',
  afterDependencyInstallation: 'Task was cancelled after dependency installation',
  beforeGitConfiguration: 'Task was cancelled before Git configuration',
}

class SandboxCancelledError extends Error {
  constructor(stage: CancellationStage) {
    super(CANCELLATION_MESSAGES[stage])
    this.name = 'SandboxCancelledError'
  }
}

type PackageJson = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

class SandboxCreationWorkflow {
  private sandbox: Sandbox | null = null
  private packageJsonDetected = false
  private requirementsTxtDetected = false
  private packageManager: 'pnpm' | 'yarn' | 'npm' | null = null
  private devPort = 3000
  private domain?: string
  private authenticatedRepoUrl = ''
  private timeoutMs = 60 * 60 * 1000
  private ports: number[] = [3000, 5173]

  constructor(
    private readonly config: SandboxConfig,
    private readonly logger: TaskLogger,
  ) {}

  async run(): Promise<SandboxResult> {
    await this.logger.info('Processing repository URL')
    await this.checkCancellation('beforeSandboxCreation')
    await this.validateEnvironment()
    await this.createSandboxInstance()
    await this.checkCancellation('afterSandboxCreation')
    await this.cloneRepository()
    await this.detectProjectFiles()
    await this.installDependenciesIfRequested()
    await this.checkCancellation('afterDependencyInstallation')
    await this.maybeStartDevServer()
    this.domain ??= this.getSandbox().domain(this.devPort)
    await this.logProjectReadiness()
    await this.checkCancellation('beforeGitConfiguration')
    await this.configureGit()
    const branchName = await this.prepareBranch()

    return {
      success: true,
      sandbox: this.getSandbox(),
      domain: this.domain,
      branchName,
    }
  }

  private async validateEnvironment(): Promise<void> {
    await this.setProgress(20, 'Validating environment variables...')
    const envValidation = validateEnvironmentVariables(
      this.config.selectedAgent,
      this.config.githubToken,
      this.config.apiKeys,
    )
    if (!envValidation.valid) {
      throw new Error(envValidation.error ?? 'Invalid sandbox configuration')
    }
    await this.logger.info('Environment variables validated')

    this.authenticatedRepoUrl = createAuthenticatedRepoUrl(this.config.repoUrl, this.config.githubToken)
    await this.logger.info('Added GitHub authentication to repository URL')

    if (this.config.timeout) {
      const numericTimeout = this.config.timeout.replaceAll(/\D/g, '')
      this.timeoutMs = numericTimeout ? Number.parseInt(numericTimeout, 10) * 60 * 1000 : 60 * 60 * 1000
    } else {
      this.timeoutMs = 60 * 60 * 1000
    }
    this.ports = this.config.ports || [3000, 5173]
  }

  private async setProgress(value: number, message: string): Promise<void> {
    if (this.config.onProgress) {
      await this.config.onProgress(value, message)
    }
  }

  private async checkCancellation(stage: CancellationStage): Promise<void> {
    if (this.config.onCancellationCheck && (await this.config.onCancellationCheck())) {
      await this.logger.info(CANCELLATION_MESSAGES[stage])
      throw new SandboxCancelledError(stage)
    }
  }

  private async createSandboxInstance(): Promise<void> {
    await this.setProgress(25, 'Validating configuration...')
    const sandboxConfig = {
      teamId: process.env.SANDBOX_VERCEL_TEAM_ID,
      projectId: process.env.SANDBOX_VERCEL_PROJECT_ID,
      token: process.env.SANDBOX_VERCEL_TOKEN,
      timeout: this.timeoutMs,
      ports: this.ports,
      runtime: this.config.runtime || 'node22',
      resources: { vcpus: this.config.resources?.vcpus || 4 },
    }

    try {
      this.sandbox = await Sandbox.create(sandboxConfig)
      await this.logger.info('Sandbox created successfully')
      registerSandbox(this.config.taskId, this.sandbox, this.config.keepAlive || false)
    } catch (error: unknown) {
      await this.handleSandboxCreationError(error)
    }
  }

  private async handleSandboxCreationError(error: unknown): Promise<never> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    const errorName = error instanceof Error ? error.name : 'UnknownError'
    const errorCode =
      error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined
    const errorResponse =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number; data?: unknown } }).response
        : undefined

    if (errorMessage?.includes('timeout') || errorCode === 'ETIMEDOUT' || errorName === 'TimeoutError') {
      await this.logger.error('Sandbox creation timed out after 5 minutes')
      await this.logger.error('This usually happens when the repository is large or has many dependencies')
      throw new Error('Sandbox creation timed out. Try with a smaller repository or fewer dependencies.')
    }

    await this.logger.error('Sandbox creation failed')
    if (errorResponse) {
      await this.logger.error('HTTP error occurred')
      await this.logger.error('Error response received')
    }
    throw error instanceof Error ? error : new Error('Failed to create sandbox')
  }

  private getSandbox(): Sandbox {
    if (!this.sandbox) {
      throw new Error('Sandbox is not initialized')
    }
    return this.sandbox
  }

  private async cloneRepository(): Promise<void> {
    const sandbox = this.getSandbox()
    await this.logger.info('Cloning repository to project directory...')

    const mkdirResult = await runCommandInSandbox(sandbox, 'mkdir', ['-p', PROJECT_DIR])
    if (!mkdirResult.success) {
      throw new Error('Failed to create project directory')
    }

    const cloneResult = await runCommandInSandbox(sandbox, 'git', [
      'clone',
      '--depth',
      '1',
      this.authenticatedRepoUrl,
      PROJECT_DIR,
    ])
    if (!cloneResult.success) {
      await this.logger.error('Failed to clone repository')
      throw new Error('Failed to clone repository to project directory')
    }

    await this.logger.info('Repository cloned successfully')
    await this.setProgress(30, 'Repository cloned, installing dependencies...')
  }

  private async detectProjectFiles(): Promise<void> {
    const sandbox = this.getSandbox()
    this.packageJsonDetected = (await runInProject(sandbox, 'test', ['-f', 'package.json'])).success
    this.requirementsTxtDetected = (await runInProject(sandbox, 'test', ['-f', 'requirements.txt'])).success
  }

  private async installDependenciesIfRequested(): Promise<void> {
    if (this.config.installDependencies === false) {
      await this.logger.info('Skipping dependency installation as requested by user')
      return
    }

    await this.logger.info('Detecting project type and installing dependencies...')

    if (this.packageJsonDetected) {
      await this.installNodeDependencies()
    } else if (this.requirementsTxtDetected) {
      await this.installPythonDependencies()
    } else {
      await this.logger.info('No package.json or requirements.txt found, skipping dependency installation')
    }
  }

  private async installNodeDependencies(): Promise<void> {
    const sandbox = this.getSandbox()
    await this.logger.info('package.json found, installing Node.js dependencies...')

    let packageManager = await detectPackageManager(sandbox, this.logger)
    if (packageManager === 'pnpm' || packageManager === 'yarn') {
      const managerInstalled = await this.ensureGlobalTool(packageManager)
      if (!managerInstalled) {
        await this.logger.error('Failed to install preferred package manager globally, falling back to npm')
        packageManager = 'npm'
      }
    }
    this.packageManager = packageManager

    await this.setProgress(35, 'Installing Node.js dependencies...')
    const installResult = await installDependencies(sandbox, packageManager, this.logger)
    await this.checkCancellation('afterDependencyInstallation')

    if (!installResult.success && packageManager !== 'npm') {
      await this.logger.info('Package manager failed, trying npm as fallback')
      await this.setProgress(37, `${packageManager} failed, trying npm fallback...`)
      const npmFallbackResult = await installDependencies(sandbox, 'npm', this.logger)
      if (!npmFallbackResult.success) {
        await this.logger.info('Warning: Failed to install Node.js dependencies, but continuing with sandbox setup')
      }
    } else if (!installResult.success) {
      await this.logger.info('Warning: Failed to install Node.js dependencies, but continuing with sandbox setup')
    }
  }

  private async ensureGlobalTool(tool: 'pnpm' | 'yarn'): Promise<boolean> {
    const sandbox = this.getSandbox()
    const check = await runInProject(sandbox, 'which', [tool])
    if (check.success) {
      return true
    }

    if (tool === 'pnpm') {
      await this.logger.info('Installing pnpm globally')
    } else {
      await this.logger.info('Installing yarn globally')
    }
    const installResult = await runInProject(sandbox, 'npm', ['install', '-g', tool])
    if (!installResult.success) {
      return false
    }
    if (tool === 'pnpm') {
      await this.logger.info('pnpm installed globally')
    } else {
      await this.logger.info('yarn installed globally')
    }
    return true
  }

  private async installPythonDependencies(): Promise<void> {
    const sandbox = this.getSandbox()
    await this.logger.info('requirements.txt found, installing Python dependencies...')
    await this.setProgress(35, 'Installing Python dependencies...')

    await this.ensurePipAvailable()

    const pipInstall = await runInProject(sandbox, 'python3', ['-m', 'pip', 'install', '-r', 'requirements.txt'])
    if (pipInstall.success) {
      await this.logger.info('Python dependencies installed successfully')
      return
    }

    await this.logger.info('pip install failed')
    await this.logger.info('Warning: Failed to install Python dependencies, but continuing with sandbox setup')
  }

  private async ensurePipAvailable(): Promise<void> {
    const sandbox = this.getSandbox()
    const pipCheck = await runInProject(sandbox, 'python3', ['-m', 'pip', '--version'])

    if (pipCheck.success) {
      await this.logger.info('pip is available')
      const pipUpgrade = await runInProject(sandbox, 'python3', ['-m', 'pip', 'install', '--upgrade', 'pip'])
      if (pipUpgrade.success) {
        await this.logger.info('pip upgraded successfully')
      } else {
        await this.logger.info('Warning: Failed to upgrade pip, continuing anyway')
      }
      return
    }

    await this.logger.info('pip not found, installing pip...')
    const getPipResult = await runCommandInSandbox(sandbox, 'sh', [
      '-c',
      'cd /tmp && curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py && python3 get-pip.py && rm -f get-pip.py',
    ])

    if (getPipResult.success) {
      await this.logger.info('pip installed successfully')
      return
    }

    await this.logger.info('Failed to install pip, trying alternative method...')
    const aptResult = await runCommandInSandbox(sandbox, 'apt-get', [
      'update',
      '&&',
      'apt-get',
      'install',
      '-y',
      'python3-pip',
    ])
    if (aptResult.success) {
      await this.logger.info('pip installed via apt-get')
    } else {
      await this.logger.info('Warning: Could not install pip, skipping Python dependencies')
    }
  }

  private async maybeStartDevServer(): Promise<void> {
    if (!this.packageJsonDetected || !this.config.installDependencies) {
      return
    }

    const packageJson = await this.readPackageJson()
    if (!packageJson) {
      await this.logger.info('Could not parse package.json, skipping auto-start of dev server')
      return
    }

    const devCommandConfig = await this.buildDevServerCommand(packageJson)
    if (!devCommandConfig) {
      return
    }

    await this.logger.info('Dev script detected, starting development server...')
    await this.startDetachedDevServer(devCommandConfig.command)
    await this.logger.info('Development server started')

    await new Promise((resolve) => setTimeout(resolve, 3000))
    this.devPort = devCommandConfig.port
    this.domain = this.getSandbox().domain(this.devPort)
    await this.logger.info('Development server is running')
  }

  private async readPackageJson(): Promise<PackageJson | null> {
    const sandbox = this.getSandbox()
    const packageJsonRead = await runInProject(sandbox, 'cat', ['package.json'])
    if (!packageJsonRead.success || !packageJsonRead.output) {
      return null
    }

    try {
      return JSON.parse(packageJsonRead.output)
    } catch {
      return null
    }
  }

  private async buildDevServerCommand(packageJson: PackageJson): Promise<{ command: string; port: number } | null> {
    if (!packageJson?.scripts?.dev) {
      return null
    }

    const sandbox = this.getSandbox()
    const packageManager = this.packageManager ?? (await detectPackageManager(sandbox, this.logger))
    let args = packageManager === 'npm' ? ['run', 'dev'] : ['dev']
    let port = this.devPort

    const hasVite = Boolean(packageJson?.dependencies?.vite || packageJson?.devDependencies?.vite)
    if (hasVite) {
      port = 5173
      await this.logger.info('Vite project detected, using port 5173')
      await this.configureViteForSandbox()
      args = packageManager === 'npm' ? ['run', 'dev', '--', '--host'] : ['dev', '--host']
    }

    const nextVersion = packageJson?.dependencies?.next || packageJson?.devDependencies?.next
    if (this.isNext16Version(nextVersion)) {
      await this.logger.info('Next.js 16 detected, adding --webpack flag')
      args = packageManager === 'npm' ? ['run', 'dev', '--', '--webpack'] : ['dev', '--webpack']
    }

    const devCommand = packageManager === 'npm' ? 'npm' : packageManager
    return { command: `${devCommand} ${args.join(' ')}`, port }
  }

  private isNext16Version(version: string | undefined): boolean {
    if (!version) {
      return false
    }
    return version.startsWith('16.') || version.startsWith('^16.') || version.startsWith('~16.')
  }

  private async configureViteForSandbox(): Promise<void> {
    const sandbox = this.getSandbox()
    await this.logger.info('Configuring Vite for sandbox environment')
    await runCommandInSandbox(sandbox, 'sh', [
      '-c',
      String.raw`mkdir -p ~/.config/git && grep -q "^vite\.config\." ~/.gitignore_global 2>/dev/null || echo "vite.config.*" >> ~/.gitignore_global`,
    ])
    await runInProject(sandbox, 'git', ['config', 'core.excludesfile', '~/.gitignore_global'])
    await this.logger.info('Added vite.config to global gitignore')

    const hasViteConfigJs = await runInProject(sandbox, 'test', ['-f', 'vite.config.js'])
    if (!hasViteConfigJs.success) {
      return
    }

    await runInProject(sandbox, 'sh', [
      '-c',
      `
# Backup original
cp vite.config.js vite.config.js.backup

# Add host: true to server config using sed
if grep -q "server:" vite.config.js; then
  sed -i "/server:[[:space:]]*{/a\\    host: true," vite.config.js
else
  sed -i "/export default defineConfig/a\\  server: { host: true }," vite.config.js  
fi
`,
    ])
    await this.logger.info('Modified vite.config.js to disable host checking (globally ignored)')
  }

  private async startDetachedDevServer(fullDevCommand: string): Promise<void> {
    const sandbox = this.getSandbox()

    const captureServerStdout = new Writable({
      write: (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
        const hasContent = chunk
          .toString()
          .split('\n')
          .some((line) => line.trim())
        if (hasContent) {
          this.logger.info('Development server log entry received').catch(() => {})
        }
        callback()
      },
    })

    const captureServerStderr = new Writable({
      write: (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
        const hasContent = chunk
          .toString()
          .split('\n')
          .some((line) => line.trim())
        if (hasContent) {
          this.logger.info('Development server log entry received').catch(() => {})
        }
        callback()
      },
    })

    await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `cd ${PROJECT_DIR} && ${fullDevCommand}`],
      detached: true,
      stdout: captureServerStdout,
      stderr: captureServerStderr,
    })
  }

  private async logProjectReadiness(): Promise<void> {
    const sandbox = this.getSandbox()
    if (this.packageJsonDetected) {
      await this.logger.info('Node.js project detected, sandbox ready for development')
      await this.logger.info('Sandbox available')
      return
    }

    if (this.requirementsTxtDetected) {
      await this.logger.info('Python project detected, sandbox ready for development')
      await this.logger.info('Sandbox available')
      const flaskAppCheck = await runInProject(sandbox, 'test', ['-f', 'app.py'])
      const djangoManageCheck = await runInProject(sandbox, 'test', ['-f', 'manage.py'])
      if (flaskAppCheck.success) {
        await this.logger.info('Flask app.py detected, you can run: python3 app.py')
      } else if (djangoManageCheck.success) {
        await this.logger.info('Django manage.py detected, you can run: python3 manage.py runserver')
      }
      return
    }

    await this.logger.info('Project type not detected, sandbox ready for general development')
    await this.logger.info('Sandbox available')
  }

  private async configureGit(): Promise<void> {
    await this.setGitAuthor()
    await this.ensureGitRepository()
  }

  private async setGitAuthor(): Promise<void> {
    const sandbox = this.getSandbox()
    const gitName = this.config.gitAuthorName || 'Coding Agent'
    const gitEmail = this.config.gitAuthorEmail || 'agent@example.com'
    await runInProject(sandbox, 'git', ['config', 'user.name', gitName])
    await runInProject(sandbox, 'git', ['config', 'user.email', gitEmail])
  }

  private async ensureGitRepository(): Promise<void> {
    const sandbox = this.getSandbox()
    const gitRepoCheck = await runInProject(sandbox, 'git', ['rev-parse', '--git-dir'])
    if (gitRepoCheck.success) {
      await this.logger.info('Git repository detected')
      return
    }

    await this.logger.info('Not in a Git repository, initializing...')
    const gitInit = await runInProject(sandbox, 'git', ['init'])
    if (!gitInit.success) {
      throw new Error('Failed to initialize Git repository')
    }
    await this.logger.info('Git repository initialized')

    const repoNameMatch = /\/([^/]+?)(\.git)?$/.exec(this.config.repoUrl)
    const repoName = repoNameMatch ? repoNameMatch[1] : 'repository'
    const readmeContent = `# ${repoName}\n`
    const createReadme = await runInProject(sandbox, 'sh', ['-c', `echo '${readmeContent}' > README.md`])
    if (!createReadme.success) {
      throw new Error('Failed to create initial README')
    }

    const checkoutMain = await runInProject(sandbox, 'git', ['checkout', '-b', 'main'])
    if (!checkoutMain.success) {
      throw new Error('Failed to create main branch')
    }

    const gitAdd = await runInProject(sandbox, 'git', ['add', 'README.md'])
    if (!gitAdd.success) {
      throw new Error('Failed to add README to git')
    }

    const gitCommit = await runInProject(sandbox, 'git', ['commit', '-m', 'Initial commit'])
    if (!gitCommit.success) {
      throw new Error('Failed to commit initial README')
    }

    await this.logger.info('Created initial commit on main branch')
    const gitPush = await runInProject(sandbox, 'git', ['push', '-u', 'origin', 'main'])
    if (gitPush.success) {
      await this.logger.info('Pushed main branch to origin')
    } else {
      await this.logger.info('Failed to push main branch to origin')
    }
  }

  private async prepareBranch(): Promise<string> {
    if (this.config.preDeterminedBranchName) {
      await this.handlePredeterminedBranch(this.config.preDeterminedBranchName)
      return this.config.preDeterminedBranchName
    }
    return this.createFallbackBranch()
  }

  private async handlePredeterminedBranch(branchName: string): Promise<void> {
    const sandbox = this.getSandbox()
    await this.logger.info('Using pre-determined branch name')

    const branchExistsLocal = await runInProject(sandbox, 'git', [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branchName}`,
    ])
    if (branchExistsLocal.success) {
      await this.logger.info('Branch already exists locally, checking it out')
      await this.checkoutBranch(branchName)
      return
    }

    const branchExistsRemote = await runInProject(sandbox, 'git', ['ls-remote', '--heads', 'origin', branchName])
    if (branchExistsRemote.success && branchExistsRemote.output?.trim()) {
      await this.logger.info('Branch exists on remote, fetching and checking it out')
      await this.ensureBranchFromRemote(branchName)
      await this.checkoutBranch(branchName)
      return
    }

    await this.logger.info('Creating new branch')
    await this.checkoutNewBranch(branchName)
  }

  private async ensureBranchFromRemote(branchName: string): Promise<void> {
    const sandbox = this.getSandbox()
    const fetchBranch = await runInProject(sandbox, 'git', ['fetch', 'origin', `${branchName}:${branchName}`])
    if (fetchBranch.success) {
      return
    }

    await this.logger.info('Failed to fetch remote branch, trying alternative method')
    const fetchAll = await runInProject(sandbox, 'git', ['fetch', 'origin'])
    if (!fetchAll.success) {
      throw new Error('Failed to fetch from remote Git repository')
    }

    const trackBranch = await runInProject(sandbox, 'git', ['branch', branchName, `origin/${branchName}`])
    if (!trackBranch.success) {
      throw new Error('Failed to prepare tracking branch')
    }
  }

  private async checkoutBranch(branchName: string): Promise<void> {
    const sandbox = this.getSandbox()
    const checkoutBranch = await runAndLogCommand(sandbox, 'git', ['checkout', branchName], this.logger, PROJECT_DIR)
    if (!checkoutBranch.success) {
      throw new Error('Failed to checkout Git branch')
    }
  }

  private async checkoutNewBranch(branchName: string): Promise<void> {
    const sandbox = this.getSandbox()
    const createBranch = await runAndLogCommand(
      sandbox,
      'git',
      ['checkout', '-b', branchName],
      this.logger,
      PROJECT_DIR,
    )
    if (!createBranch.success) {
      throw new Error('Failed to create Git branch')
    }
    await this.logger.info('Successfully created branch')
  }

  private async createFallbackBranch(): Promise<string> {
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-').slice(0, -5)
    const suffix = generateId()
    const branchName = `agent/${timestamp}-${suffix}`
    await this.logger.info('No predetermined branch name, using timestamp-based branch')
    await this.checkoutNewBranch(branchName)
    await this.logger.info('Successfully created fallback branch')
    return branchName
  }
}

export async function createSandbox(config: SandboxConfig, logger: TaskLogger): Promise<SandboxResult> {
  try {
    const workflow = new SandboxCreationWorkflow(config, logger)
    return await workflow.run()
  } catch (error: unknown) {
    if (error instanceof SandboxCancelledError) {
      return { success: false, cancelled: true }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('Sandbox creation error:', error)
    await logger.error('Error occurred during sandbox creation')

    return {
      success: false,
      error: errorMessage || 'Failed to create sandbox',
    }
  }
}
