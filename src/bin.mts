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
import { buildProjectSessionHistoryReport } from "./session-history.js";
import { cleanupProjectRuntimeState } from "./state-cleanup.js";

function printHelp(): void {
  console.log(`RepoScope\n\nUsage:\n  reposcope                              Start the stdio MCP server\n  reposcope mcp                          Start an unbound stdio MCP server\n  reposcope mcp --project DIR            Start a stdio MCP server hard-bound to one project\n  reposcope install cursor               Install project-scoped Cursor integration\n  reposcope install codex                Install project-scoped Codex integration\n  reposcope install cursor --project DIR Install Cursor integration in a specific project\n  reposcope install codex --project DIR  Install Codex integration in a specific project\n  reposcope cursor-install               Legacy alias for project-scoped Cursor install\n  reposcope cursor-install --project DIR Legacy Cursor install for a specific project\n  reposcope cursor-install --global      Install Cursor integration globally\n  reposcope cursor-config                Print the Cursor MCP JSON snippet\n  reposcope project-report               Print accumulated session metrics for the current project\n  reposcope project-report --project DIR Print accumulated session metrics for a project\n  reposcope repo-stats                    Explain the current project's whole-repo token estimate\n  reposcope repo-stats --project DIR      Explain a project's whole-repo token estimate\n  reposcope help                         Show this help`);
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

const command = process.argv[2] ?? "mcp";

try {
  if (command === "install") {
    const options = parseAgentInstallArgs(process.argv.slice(3));
    const result = await installAgentIntegration(options.agent, {
      projectRoot: options.projectRoot,
    });

    console.log(`RepoScope ${result.agent} integration installed.`);
    console.log(`Project: ${result.projectRoot}`);
    for (const path of result.configPaths) {
      console.log(`Config: ${path}`);
    }
    for (const path of result.guidancePaths) {
      console.log(`Guidance: ${path}`);
    }
    console.log(`MCP package: ${result.packageSpec}`);
    console.log("Restart or reload the Agent integration to pick up the changes.");
  } else if (command === "cursor-install") {
    const options = parseCursorInstallArgs(process.argv.slice(3));
    const result = await installCursorIntegration(options);

    console.log(`RepoScope Cursor integration installed (${result.scope}).`);
    if (result.projectRoot) {
      console.log(`Project: ${result.projectRoot}`);
    }
    console.log(`MCP config: ${result.mcpConfigPath}`);
    for (const skillPath of result.skillPaths) {
      console.log(`Skill: ${skillPath}`);
    }
    if (result.rulePath) {
      console.log(`Rule: ${result.rulePath}`);
    }
    console.log(`MCP package: ${result.packageSpec}`);
    console.log("Restart Cursor or reload MCPs to pick up the changes.");
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
