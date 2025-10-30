import { SandboxType as Sandbox } from '@/lib/sandbox'
import { AgentExecutionResult } from './index'

export async function executeDeepSeekInSandbox(
  sandbox: Sandbox,
  instruction: string,
  logger: { info: (msg: string) => Promise<void>; error: (msg: string) => Promise<void> },
  selectedModel?: string,
  mcpServers?: any
): Promise<AgentExecutionResult> {
  const ollamaHost = process.env.OLLAMA_HOST || 'http://host.docker.internal:11434'
  const model = selectedModel || 'deepseek-coder:6.7b'
  
  await logger.info('Using DeepSeek model: ' + model)
  
  const pythonScript = `import requests
import json
import sys

ollama_host = "${ollamaHost}"
model = "${model}"

prompt = sys.argv[1] if len(sys.argv) > 1 else "Hello"

response = requests.post(
    f"{ollama_host}/api/generate",
    json={"model": model, "prompt": prompt, "stream": False}
)

if response.status_code == 200:
    result = response.json()
    print(result.get("response", ""))
else:
    print(f"Error: {response.status_code}", file=sys.stderr)
    sys.exit(1)`
  
  await sandbox.runCommand(`echo '${pythonScript}' > /tmp/deepseek_ollama.py`)
  
  const result = await sandbox.runCommand(`python3 /tmp/deepseek_ollama.py "${instruction}"`)
  
  return {
    success: result.exitCode === 0,
    changesDetected: (await result.stdout()).length > 0,
    agentResponse: await result.stdout(),
    error: result.exitCode !== 0 ? await result.stderr() : undefined
  }
}
