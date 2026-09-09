import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { upsertManagedBlock, withoutManagedBlock } from "./managed-block.js";
import {
  buildMcpLaunchSpec,
  DEFAULT_NPX_SPEC,
  type McpLaunchSpec,
} from "./mcp-launch.mjs";

const CODEX_MCP_START = "# >>> RepoScope managed MCP >>>";
const CODEX_MCP_END = "# <<< RepoScope managed MCP <<<";
const AGENTS_START = "<!-- >>> RepoScope managed guidance >>> -->";
const AGENTS_END = "<!-- <<< RepoScope managed guidance <<< -->";

export type CodexInstallResult = {
  projectRoot: string;
  configPath: string;
  agentsPath: string;
  packageSpec: string;
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildCodexMcpBody(
  packageSpec: string,
  projectRoot: string,
  launchSpec?: McpLaunchSpec,
): string {
  const launch = launchSpec ?? buildMcpLaunchSpec(packageSpec, projectRoot);
  const args = launch.args.map(tomlString).join(", ");

  return [
    "[mcp_servers.reposcope]",
    `command = ${tomlString(launch.command)}`,
    `args = [${args}]`,
  ].join("\n");
}

function buildCodexGuidance(): string {
  return `## RepoScope repository context policy

For repository exploration in this project, use the RepoScope MCP server as the repository context gateway.

- Start one task session with \`repo_session_start\` before repository exploration.
- Use \`repo_search\` to localize relevant files, then prefer narrow \`repo_read\` line ranges around match locations.
- Do not read an entire large source file merely because one hit points into it. Expand only when a concrete information gap remains.
- Keep the same \`sessionId\` for the task and finish it with \`repo_session_finish\` when complete or abandoned.
- Do not silently bypass RepoScope with broad native repository search/read while RepoScope is available. If RepoScope fails, report the limitation or change strategy rather than looping the same failed call.
- For debugging or correctness review, follow the shortest direct producer -> transformation -> consumer evidence chain. Keep confirmed, suspected, and unknown claims separate.
- Use normal Codex reasoning and editing after the relevant source has been acquired through RepoScope. Verification may use repository-approved RepoScope commands when useful.`;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function assertNoUnmanagedRepoScopeMcp(content: string): void {
  const unmanaged = withoutManagedBlock(content, CODEX_MCP_START, CODEX_MCP_END);
  const tablePattern = /^\s*\[mcp_servers\.(?:reposcope|"reposcope")\]\s*$/m;

  if (tablePattern.test(unmanaged)) {
    throw new Error(
      "Codex config already contains an unmanaged [mcp_servers.reposcope] entry; refusing to overwrite it.",
    );
  }
}

export async function installCodexIntegration(options?: {
  projectRoot?: string;
  packageSpec?: string;
  launchSpec?: McpLaunchSpec;
}): Promise<CodexInstallResult> {
  const projectRoot = await realpath(resolve(options?.projectRoot ?? process.cwd()));
  const packageSpec = options?.packageSpec ?? DEFAULT_NPX_SPEC;
  const codexDir = join(projectRoot, ".codex");
  const configPath = join(codexDir, "config.toml");
  const agentsPath = join(projectRoot, "AGENTS.md");

  const [existingConfig, existingAgents] = await Promise.all([
    readOptional(configPath),
    readOptional(agentsPath),
  ]);

  assertNoUnmanagedRepoScopeMcp(existingConfig);

  const nextConfig = upsertManagedBlock(
    existingConfig,
    CODEX_MCP_START,
    CODEX_MCP_END,
    buildCodexMcpBody(packageSpec, projectRoot, options?.launchSpec),
  );
  const nextAgents = upsertManagedBlock(
    existingAgents,
    AGENTS_START,
    AGENTS_END,
    buildCodexGuidance(),
  );

  await mkdir(codexDir, { recursive: true });
  await Promise.all([
    writeFile(configPath, nextConfig, "utf8"),
    writeFile(agentsPath, nextAgents, "utf8"),
  ]);

  return {
    projectRoot,
    configPath,
    agentsPath,
    packageSpec,
  };
}

export const CODEX_MANAGED_MARKERS = {
  mcpStart: CODEX_MCP_START,
  mcpEnd: CODEX_MCP_END,
  agentsStart: AGENTS_START,
  agentsEnd: AGENTS_END,
} as const;
