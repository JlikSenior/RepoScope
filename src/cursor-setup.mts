import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_NPX_SPEC = "github:JlikSenior/RepoScope#main";

export type CursorInstallResult = {
  mcpConfigPath: string;
  skillPaths: string[];
  packageSpec: string;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildCursorMcpServer(packageSpec = DEFAULT_NPX_SPEC) {
  return {
    type: "stdio" as const,
    command: "npx",
    args: ["-y", "--prefer-online", packageSpec],
  };
}

export function buildCursorMcpSnippet(packageSpec = DEFAULT_NPX_SPEC) {
  return {
    mcpServers: {
      reposcope: buildCursorMcpServer(packageSpec),
    },
  };
}

async function readExistingConfig(path: string): Promise<JsonObject> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isObject(parsed)) {
      throw new Error("Cursor mcp.json must contain a JSON object");
    }

    return parsed;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Cannot update ${path}: existing file is not valid JSON`);
    }

    throw error;
  }
}

async function installSkill(
  packageRoot: string,
  skillRoot: string,
  skillName: string,
): Promise<string> {
  const source = join(packageRoot, "skills", skillName, "SKILL.md");
  const targetDir = join(skillRoot, skillName);
  const target = join(targetDir, "SKILL.md");
  const content = await readFile(source, "utf8");

  await mkdir(targetDir, { recursive: true });
  await writeFile(target, content, "utf8");

  return target;
}

export async function installCursorIntegration(options?: {
  homeDir?: string;
  packageRoot?: string;
  packageSpec?: string;
}): Promise<CursorInstallResult> {
  const homeDir = options?.homeDir ?? homedir();
  const packageRoot =
    options?.packageRoot ?? fileURLToPath(new URL("../", import.meta.url));
  const packageSpec = options?.packageSpec ?? DEFAULT_NPX_SPEC;
  const cursorDir = join(homeDir, ".cursor");
  const mcpConfigPath = join(cursorDir, "mcp.json");
  const skillRoot = join(homeDir, ".agents", "skills");

  await mkdir(cursorDir, { recursive: true });

  const config = await readExistingConfig(mcpConfigPath);
  const existingServers = config.mcpServers;

  if (existingServers !== undefined && !isObject(existingServers)) {
    throw new Error(
      `Cannot update ${mcpConfigPath}: mcpServers must be a JSON object`,
    );
  }

  config.mcpServers = {
    ...(existingServers ?? {}),
    reposcope: buildCursorMcpServer(packageSpec),
  };

  await writeFile(
    mcpConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );

  const skillPaths = await Promise.all([
    installSkill(packageRoot, skillRoot, "reposcope"),
    installSkill(packageRoot, skillRoot, "reposcope-benchmark"),
  ]);

  return {
    mcpConfigPath,
    skillPaths,
    packageSpec,
  };
}
