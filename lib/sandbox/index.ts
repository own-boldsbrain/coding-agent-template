// Compatibility layer - exports DockerSandbox as Sandbox for drop-in replacement
import { DockerSandbox } from './docker-sandbox'

// Create a factory function that returns the sandbox as any to avoid type conflicts
export const Sandbox = DockerSandbox as any
export type { Sandbox as SandboxType } from '@vercel/sandbox'
