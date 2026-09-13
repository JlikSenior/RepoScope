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
  return `## RepoScope assistive repository exploration

RepoScope is available as an optional context-efficiency and observability layer. It is not a mandatory repository-access gateway.

- When using RepoScope, start one task session with \`repo_session_start\` and keep the same \`sessionId\` for RepoScope calls.
- Use \`repo_search\` as a cheap fixed-string first pass when task-derived terms are likely to help, then use \`repo_read\` ranges when a narrow window is genuinely sufficient.
- Treat RepoScope rankings as hints rather than a completeness or causality guarantee.
- Native Codex repository search, grep, semantic/symbol/reference navigation, and direct source reads remain allowed while RepoScope is available.
- For debugging or correctness review, broaden beyond RepoScope when the hypothesis is uncertain, the symptom may be distant from the cause, semantic/reference navigation is useful, or RepoScope results do not explain the behavior.
- If one or two RepoScope localization steps fail to produce direct evidence, change strategy instead of repeatedly refining the same keyword hypothesis.
- Re-reading evidence is allowed when a changed hypothesis makes earlier source relevant again.
- Keep confirmed, suspected, and unknown claims separate, and do not declare a root cause without direct evidence when verification is practical.
- RepoScope source-budget metrics measure source delivered through RepoScope, not total provider/model input tokens.
- Use normal Codex reasoning, editing, repository exploration, and verification at any point. RepoScope guarded writes and approved verification commands remain optional utilities.
- If a RepoScope session was started, finish it with \`repo_session_finish\` when the task is complete or abandoned.`;
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
