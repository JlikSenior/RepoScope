export const DEFAULT_NPX_SPEC = "github:JlikSenior/RepoScope#main";

export type McpLaunchSpec = {
  command: string;
  args: string[];
};

export function buildMcpLaunchSpec(
  packageSpec = DEFAULT_NPX_SPEC,
  projectRoot?: string,
): McpLaunchSpec {
  const args = ["-y", "--prefer-online", packageSpec];

  if (projectRoot) {
    args.push("mcp", "--project", projectRoot);
  }

  return {
    command: "npx",
    args,
  };
}

export function buildInstalledRuntimeMcpLaunchSpec(
  runtimeEntryPath: string,
  projectRoot?: string,
): McpLaunchSpec {
  const args = [runtimeEntryPath];

  if (projectRoot) {
    args.push("mcp", "--project", projectRoot);
  }

  return {
    command: "node",
    args,
  };
}
