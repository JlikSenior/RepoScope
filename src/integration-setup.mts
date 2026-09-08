import { installCodexIntegration } from "./codex-setup.mjs";
import { installCursorIntegration } from "./cursor-setup.mjs";
import { DEFAULT_NPX_SPEC } from "./mcp-launch.mjs";

export type SupportedAgent = "cursor" | "codex";

export type AgentIntegrationInstallResult = {
  agent: SupportedAgent;
  projectRoot: string;
  configPaths: string[];
  guidancePaths: string[];
  packageSpec: string;
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
  },
): Promise<AgentIntegrationInstallResult> {
  const packageSpec = options?.packageSpec ?? DEFAULT_NPX_SPEC;

  if (agent === "cursor") {
    const result = await installCursorIntegration({
      scope: "project",
      projectRoot: options?.projectRoot,
      packageRoot: options?.packageRoot,
      packageSpec,
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
    };
  }

  const result = await installCodexIntegration({
    projectRoot: options?.projectRoot,
    packageSpec,
  });

  return {
    agent,
    projectRoot: result.projectRoot,
    configPaths: [result.configPath],
    guidancePaths: [result.agentsPath],
    packageSpec,
  };
}
