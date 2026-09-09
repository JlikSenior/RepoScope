import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { CODEX_MANAGED_MARKERS } from "./codex-setup.mjs";
import type { SupportedAgent } from "./integration-setup.mjs";
import { withoutManagedBlock } from "./managed-block.js";

export type AgentIntegrationUninstallResult = {
  agent: SupportedAgent;
  projectRoot: string;
  updatedPaths: string[];
  removedPaths: string[];
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function uninstallCursor(projectRoot: string): Promise<AgentIntegrationUninstallResult> {
  const cursorDir = join(projectRoot, ".cursor");
  const mcpConfigPath = join(cursorDir, "mcp.json");
  const rulePath = join(cursorDir, "rules", "reposcope.mdc");
  const skillPaths = [
    join(cursorDir, "skills", "reposcope"),
    join(cursorDir, "skills", "reposcope-benchmark"),
  ];
  const updatedPaths: string[] = [];
  const removedPaths: string[] = [];

  const raw = await readOptional(mcpConfigPath);
  if (raw !== undefined) {
    let config: unknown;
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error(`Cannot uninstall RepoScope from ${mcpConfigPath}: file is not valid JSON`);
    }
    if (!isObject(config)) {
      throw new Error(`Cannot uninstall RepoScope from ${mcpConfigPath}: root must be a JSON object`);
    }

    const servers = config.mcpServers;
    if (servers !== undefined && !isObject(servers)) {
      throw new Error(`Cannot uninstall RepoScope from ${mcpConfigPath}: mcpServers must be a JSON object`);
    }

    if (isObject(servers) && Object.prototype.hasOwnProperty.call(servers, "reposcope")) {
      delete servers.reposcope;
      await writeFile(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      updatedPaths.push(mcpConfigPath);
    }
  }

  for (const path of [rulePath, ...skillPaths]) {
    try {
      await rm(path, { recursive: true });
      removedPaths.push(path);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return {
    agent: "cursor",
    projectRoot,
    updatedPaths,
    removedPaths,
  };
}

async function uninstallCodex(projectRoot: string): Promise<AgentIntegrationUninstallResult> {
  const configPath = join(projectRoot, ".codex", "config.toml");
  const agentsPath = join(projectRoot, "AGENTS.md");
  const updatedPaths: string[] = [];

  const config = await readOptional(configPath);
  if (config !== undefined) {
    const next = withoutManagedBlock(
      config,
      CODEX_MANAGED_MARKERS.mcpStart,
      CODEX_MANAGED_MARKERS.mcpEnd,
    );
    if (next !== config) {
      await writeFile(configPath, next, "utf8");
      updatedPaths.push(configPath);
    }
  }

  const agents = await readOptional(agentsPath);
  if (agents !== undefined) {
    const next = withoutManagedBlock(
      agents,
      CODEX_MANAGED_MARKERS.agentsStart,
      CODEX_MANAGED_MARKERS.agentsEnd,
    );
    if (next !== agents) {
      await writeFile(agentsPath, next, "utf8");
      updatedPaths.push(agentsPath);
    }
  }

  return {
    agent: "codex",
    projectRoot,
    updatedPaths,
    removedPaths: [],
  };
}

export async function uninstallAgentIntegration(
  agent: SupportedAgent,
  options?: { projectRoot?: string },
): Promise<AgentIntegrationUninstallResult> {
  const projectRoot = await realpath(resolve(options?.projectRoot ?? process.cwd()));
  return agent === "cursor"
    ? uninstallCursor(projectRoot)
    : uninstallCodex(projectRoot);
}
