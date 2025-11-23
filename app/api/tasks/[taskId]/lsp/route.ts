/** @format */

import { PROJECT_DIR } from "@/lib/sandbox/commands";
import { type NextRequest, NextResponse } from "next/server";
import {
  TaskRouteError,
  buildTaskRouteContext,
  getActiveSandbox,
  handleTaskRouteError,
  type TaskRouteContext,
} from "../task-route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/tasks/[taskId]/lsp
 * Handles LSP requests by executing TypeScript language service queries in the sandbox
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const context = await buildTaskRouteContext({ params });
    const sandbox = await resolveSandbox(context);
    const body = await parseRequestBody(request);
    const handler = lspHandlers[body.method as LspMethod];

    if (!handler) {
      throw new TaskRouteError("Unsupported LSP method", 400);
    }

    return await handler({ sandbox, body });
  } catch (error) {
    return handleTaskRouteError(error, "Failed to process LSP request", {
      400: "Task does not have an active sandbox",
      410: "Sandbox is not running",
    });
  }
}

type ActiveSandbox = Awaited<ReturnType<typeof getActiveSandbox>>;
type LspMethod =
  | "textDocument/definition"
  | "textDocument/hover"
  | "textDocument/completion";

interface LspRequestBody {
  method: string;
  filename?: string;
  position?: { line: number; character: number };
  textDocument?: unknown;
}

interface LspHandlerContext {
  sandbox: ActiveSandbox;
  body: LspRequestBody;
}

type LspHandler = (context: LspHandlerContext) => Promise<NextResponse>;

const lspHandlers: Record<LspMethod, LspHandler> = {
  "textDocument/definition": handleDefinitionRequest,
  "textDocument/hover": async () => NextResponse.json({ hover: null }),
  "textDocument/completion": async () => NextResponse.json({ completions: [] }),
};

async function resolveSandbox(context: TaskRouteContext) {
  const { task } = context;

  if (!task.sandboxId) {
    throw new TaskRouteError("Task does not have an active sandbox", 400);
  }

  return getActiveSandbox(task.id, task.sandboxId);
}

async function parseRequestBody(request: NextRequest): Promise<LspRequestBody> {
  try {
    const body = await request.json();
    return typeof body === "object" && body ? body : { method: "" };
  } catch {
    return { method: "" };
  }
}

async function handleDefinitionRequest({ sandbox, body }: LspHandlerContext) {
  if (!body.filename || !body.position) {
    throw new TaskRouteError("Filename and position are required", 400);
  }

  const absoluteFilename = toAbsolutePath(body.filename);
  const scriptPath = ".lsp-helper.mjs";
  const helperScript = buildDefinitionHelperScript(
    absoluteFilename,
    body.position.line,
    body.position.character
  );

  await writeHelperScript(sandbox, scriptPath, helperScript);

  try {
    const result = await sandbox.runCommand({
      cmd: "node",
      args: [scriptPath],
      cwd: PROJECT_DIR,
    });

    const { stdout, stderr } = await collectCommandOutput(result);

    if (result.exitCode !== 0) {
      console.error("LSP helper execution failed", stderr);
      return NextResponse.json({
        definitions: [],
        error: stderr || "Script execution failed",
      });
    }

    try {
      const parsed = JSON.parse(stdout.trim());
      return NextResponse.json(parsed);
    } catch (parseError) {
      console.error("Failed to parse LSP helper output", parseError);
      return NextResponse.json({
        definitions: [],
        error: "Failed to parse TypeScript response",
      });
    }
  } finally {
    await sandbox
      .runCommand({ cmd: "rm", args: ["-f", scriptPath], cwd: PROJECT_DIR })
      .catch((error) =>
        console.error("Failed to clean up LSP helper script", error)
      );
  }
}

async function writeHelperScript(
  sandbox: ActiveSandbox,
  scriptPath: string,
  contents: string
) {
  const writeCommand = `cat > '${scriptPath}' << 'EOF'\n${contents}\nEOF`;
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", writeCommand],
    cwd: PROJECT_DIR,
  });
}

async function collectCommandOutput(
  result: Awaited<ReturnType<ActiveSandbox["runCommand"]>>
) {
  let stdout = "";
  let stderr = "";

  try {
    stdout = await result.stdout();
  } catch (error) {
    console.error("Failed to read LSP stdout", error);
  }

  try {
    stderr = await result.stderr();
  } catch (error) {
    console.error("Failed to read LSP stderr", error);
  }

  return { stdout, stderr };
}

function toAbsolutePath(filename: string) {
  return filename.startsWith("/") ? filename : `/${filename}`;
}

function buildDefinitionHelperScript(
  filename: string,
  line: number,
  character: number
) {
  const filenameLiteral = JSON.stringify(filename);
  return `
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

const filename = ${filenameLiteral};
const line = ${line};
const character = ${character};

let configPath = process.cwd();
while (configPath !== '/') {
  const tsconfigPath = path.join(configPath, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    break;
  }
  configPath = path.dirname(configPath);
}

const tsconfigPath = path.join(configPath, 'tsconfig.json');
const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  configPath
);

const files = new Map();
const host = {
  getScriptFileNames: () => parsedConfig.fileNames,
  getScriptVersion: (fileName) => {
    const file = files.get(fileName);
    return file && file.version ? file.version.toString() : '0';
  },
  getScriptSnapshot: (fileName) => {
    if (!fs.existsSync(fileName)) return undefined;
    const content = fs.readFileSync(fileName, 'utf8');
    return ts.ScriptSnapshot.fromString(content);
  },
  getCurrentDirectory: () => configPath,
  getCompilationSettings: () => parsedConfig.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

const fullPath = path.resolve(configPath, filename.replace(/^\\/*/g, ''));
const program = service.getProgram();
if (!program) {
  console.error(JSON.stringify({ error: 'Failed to get program' }));
  process.exit(1);
}

const sourceFile = program.getSourceFile(fullPath);
if (!sourceFile) {
  console.error(JSON.stringify({ error: 'File not found' }));
  process.exit(1);
}

const offset = ts.getPositionOfLineAndCharacter(sourceFile, line, character);
const definitions = service.getDefinitionAtPosition(fullPath, offset);

if (definitions && definitions.length > 0) {
  const results = definitions.map(def => {
    const defSourceFile = program.getSourceFile(def.fileName);
    if (!defSourceFile) {
      return null;
    }
    
    const start = ts.getLineAndCharacterOfPosition(defSourceFile, def.textSpan.start);
    const end = ts.getLineAndCharacterOfPosition(defSourceFile, def.textSpan.start + def.textSpan.length);
    
    return {
      uri: 'file://' + def.fileName,
      range: {
        start,
        end,
      },
    };
  }).filter(Boolean);
  
  console.log(JSON.stringify({ definitions: results }));
} else {
  console.log(JSON.stringify({ definitions: [] }));
}
`;
}
