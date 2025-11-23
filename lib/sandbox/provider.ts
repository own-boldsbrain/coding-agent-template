import type { DockerSandbox } from './docker-sandbox'

export { DockerSandbox as Sandbox } from './docker-sandbox'
export type { DockerSandbox as SandboxType } from './docker-sandbox'
export type SandboxConfig = Parameters<typeof DockerSandbox.create>[0]
export const usingDockerSandbox = true
