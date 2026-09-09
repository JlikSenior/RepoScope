#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildCursorMcpSnippet,
  DEFAULT_NPX_SPEC,
  installCursorIntegration,
  type CursorInstallScope,
} from "./cursor-setup.mjs";
import {
  installAgentIntegration,
  parseSupportedAgent,
  type SupportedAgent,
} from "./integration-setup.mjs";
import { buildRepoStats } from "./repo-stats.js";
import {
  ensureLocalRuntime,
  getInstalledRuntime,
  getRuntimeRootPath,
  installLocalRuntime,
} from "./runtime-install.mjs";
import { buildProjectSessionHistoryReport } from "./session-history.js";
import { cleanupProjectRuntimeState } from "./state-cleanup.js";

function printHelp(): void {
  console.log(`RepoScope\n\nUsage:\n  reposcope                              Start the stdio MCP server\n  reposcope mcp                          Start an unbound stdio MCP server\n  reposcope mcp --project DIR            Start a stdio MCP server hard-bound to one project\n  reposcope install cursor               Ensure local runtime and install project Cursor adapter\n  reposcope install codex                Ensure local runtime and install project Codex adapter\n  reposcope install cursor --project DIR Install Cursor adapter for a specific project\n  reposcope install codex --project DIR  Install Codex adapter for a specific project\n  reposcope runtime install              Install/update the fixed local RepoScope runtime\n  reposcope runtime install --source SRC Install/update runtime from a package source\n  reposcope runtime status               Show the installed local runtime\n  reposcope cursor-install               Legacy alias for project-scoped Cursor install\n  reposcope cursor-install --project DIR Legacy Cursor install for a specific project\n  reposcope cursor-install --global      Install unbound Cursor integration globally\n  reposcope cursor-config                Print the generic npx Cursor MCP JSON snippet\n  reposcope project-report               Print accumulated session metrics for the current project\n  reposcope project-report --project DIR Print accumulated session metrics for a project\n  reposcope repo-stats                    Explain the current project's whole-repo token estimate\n  reposcope repo-stats --project DIR      Explain a project's whole-repo token estimate\n  reposcope help                         Show this help`);
}

function parseCursorInstallArgs(args: string[]): {
  scope: CursorInstallScope;
  projectRoot?: string;
} {
  if (args.length === 0) {
    return { scope: "project", projectRoot: process.cwd() };
  }

  if (args.length === 1 && args[0] === "--global") {
    return { scope: "global" };
  }

  if (args.length === 2 && args[0] === "--project") {
    return { scope: "project", projectRoot: args[1] };
  }

  throw new Error(
    "Usage: reposcope cursor-install [--global | --project <directory>]",
  );
}

function parseAgentInstallArgs(args: string[]): {
  agent: SupportedAgent;
  projectRoot: string;
} {
  if (args.length === 1) {
    return {
      agent: parseSupportedAgent(args[0]),
      projectRoot: process.cwd(),
    };
  }

  if (args.length === 3 && args[1] === "--project") {
    return {
      agent: parseSupportedAgent(args[0]),
      projectRoot: args[2],
    };
  }

  throw new Error(
    "Usage: reposcope install <cursor|codex> [--project <directory>]",
  );
}

function parseRuntimeArgs(args: string[]):
  | { action: "install"; sourceSpec: string }
  | { action: "status" } {
  if (args.length === 1 && args[0] === "install") {
    return { action: "install", sourceSpec: DEFAULT_NPX_SPEC };
  }

  if (
    args.length === 3 &&
    args[0] === "install" &&
    args[1] === "--source"
  ) {
    return { action: "install", sourceSpec: args[2] };
  }

  if (args.length === 1 && args[0] === "status") {
    return { action: "status" };
  }

  throw new Error(
    "Usage: reposcope runtime <install [--source <package>] | status>",
  );
}

function parseProjectArg(args: string[], command: string): string {
  if (args.length === 0) return process.cwd();
  if (args.length === 2 && args[0] === "--project") return args[1];
  throw new Error(`Usage: reposcope ${command} [--project <directory>]`);
}

async function parseMcpProjectArg(args: string[]): Promise<string | undefined> {
  if (args.length === 0) return undefined;

  if (args.length === 2 && args[0] === "--project") {
    return realpath(resolve(args[1]));
  }

  throw new Error("Usage: reposcope mcp [--project <directory>]");
}

async function installProjectAgent(
  agent: SupportedAgent,
  projectRoot: string,
): Promise<void> {
  const runtime = await ensureLocalRuntime(DEFAULT_NPX_SPEC);
  const result = await installAgentIntegration(agent, {
    projectRoot,
    runtimeEntryPath: runtime.entryPath,
  });

  console.log(`RepoScope ${result.agent} integration installed.`);
  console.log(`Project: ${result.projectRoot}`);
  console.log(`Runtime: ${runtime.entryPath}`);
  for (const path of result.configPaths) {
    console.log(`Config: ${path}`);
  }
  for (const path of result.guidancePaths) {
    console.log(`Guidance: ${path}`);
  }
  console.log("Restart or reload the Agent integration to pick up the changes.");
}

const command = process.argv[2] ?? "mcp";

try {
  if (command === "install") {
    const options = parseAgentInstallArgs(process.argv.slice(3));
    await installProjectAgent(options.agent, options.projectRoot);
  } else if (command === "runtime") {
    const options = parseRuntimeArgs(process.argv.slice(3));

    if (options.action === "install") {
      const runtime = await installLocalRuntime(options.sourceSpec);
      console.log(JSON.stringify({ installed: true, ...runtime }, null, 2));
    } else {
      const runtime = await getInstalledRuntime();
      console.log(
        JSON.stringify(
          runtime
            ? { installed: true, ...runtime }
            : {
                installed: false,
                runtimeRoot: getRuntimeRootPath(),
              },
          null,
          2,
        ),
      );
    }
  } else if (command === "cursor-install") {
    const options = parseCursorInstallArgs(process.argv.slice(3));

    if (options.scope === "project") {
      const projectRoot = options.projectRoot ?? process.cwd();
      await installProjectAgent("cursor", projectRoot);
    } else {
      const result = await installCursorIntegration(options);
      console.log(`RepoScope Cursor integration installed (${result.scope}).`);
      console.log(`MCP config: ${result.mcpConfigPath}`);
      for (const skillPath of result.skillPaths) {
        console.log(`Skill: ${skillPath}`);
      }
      console.log(`MCP package: ${result.packageSpec}`);
      console.log("Restart Cursor or reload MCPs to pick up the changes.");
    }
  } else if (command === "cursor-config") {
    console.log(JSON.stringify(buildCursorMcpSnippet(DEFAULT_NPX_SPEC), null, 2));
  } else if (command === "project-report") {
    const projectRoot = parseProjectArg(process.argv.slice(3), command);
    const report = await buildProjectSessionHistoryReport(projectRoot);
    console.log(JSON.stringify(report, null, 2));
  } else if (command === "repo-stats") {
    const projectRoot = parseProjectArg(process.argv.slice(3), command);
    const report = await buildRepoStats(projectRoot);
    console.log(JSON.stringify(report, null, 2));
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "mcp") {
    const projectRoot = await parseMcpProjectArg(process.argv.slice(3));
    if (projectRoot) {
      process.env.REPOSCOPE_BOUND_PROJECT = projectRoot;
      const cleanup = await cleanupProjectRuntimeState(projectRoot);
      if (
        cleanup.removedActiveSessions > 0 ||
        cleanup.removedTempFiles > 0 ||
        cleanup.removedLegacyLocators > 0
      ) {
        console.error(
          `RepoScope cleaned stale project state: ${JSON.stringify(cleanup)}`,
        );
      }
    }

    const [{ serveStdio }, { createRepoScopeServer }] = await Promise.all([
      import("@modelcontextprotocol/server/stdio"),
      import("./mcp.mjs"),
    ]);

    await serveStdio(createRepoScopeServer);
  } else {
    console.error(`Unknown RepoScope command: ${command}`);
    printHelp();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
