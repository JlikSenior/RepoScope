import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { installCodexIntegration } from "./codex-setup.mjs";
import { installCursorIntegration } from "./cursor-setup.mjs";
import {
  buildInstalledRuntimeMcpLaunchSpec,
  buildMcpLaunchSpec,
  DEFAULT_NPX_SPEC,
  type McpLaunchSpec,
} from "./mcp-launch.mjs";

export type SupportedAgent = "cursor" | "codex";

export type AgentIntegrationInstallResult = {
  agent: SupportedAgent;
  projectRoot: string;
  configPaths: string[];
  guidancePaths: string[];
  packageSpec: string;
  launchSpec: McpLaunchSpec;
};

export function parseSupportedAgent(value: string): SupportedAgent {
  if (value === "cursor" || value === "codex") return value;
  throw new Error(`Unsupported RepoScope agent integration: ${value}`);
}

export async function installAgentIntegration(
  agent: SupportedAgent,
  options?: {
    projectRoot?: string;
    packageRoot?: string;
    packageSpec?: string;
    runtimeEntryPath?: string;
  },
): Promise<AgentIntegrationInstallResult> {
  const packageSpec = options?.packageSpec ?? DEFAULT_NPX_SPEC;
  const projectRoot = await realpath(resolve(options?.projectRoot ?? process.cwd()));
  const launchSpec = options?.runtimeEntryPath
    ? buildInstalledRuntimeMcpLaunchSpec(options.runtimeEntryPath, projectRoot)
    : buildMcpLaunchSpec(packageSpec, projectRoot);

  if (agent === "cursor") {
    const result = await installCursorIntegration({
      scope: "project",
      projectRoot,
      packageRoot: options?.packageRoot,
      packageSpec,
      launchSpec,
    });

    if (!result.projectRoot) {
      throw new Error("Cursor project integration did not resolve a project root");
    }

    return {
      agent,
      projectRoot: result.projectRoot,
      configPaths: [result.mcpConfigPath],
      guidancePaths: [
        ...result.skillPaths,
        ...(result.rulePath ? [result.rulePath] : []),
      ],
      packageSpec,
      launchSpec,
    };
  }

  const result = await installCodexIntegration({
    projectRoot,
    packageSpec,
    launchSpec,
  });

  return {
    agent,
    projectRoot: result.projectRoot,
    configPaths: [result.configPath],
    guidancePaths: [result.agentsPath],
    packageSpec,
    launchSpec,
  };
}
