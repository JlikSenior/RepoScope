#!/usr/bin/env node

import {
  buildCursorMcpSnippet,
  DEFAULT_NPX_SPEC,
  installCursorIntegration,
  type CursorInstallScope,
} from "./cursor-setup.mjs";

function printHelp(): void {
  console.log(`RepoScope\n\nUsage:\n  reposcope                              Start the stdio MCP server\n  reposcope mcp                          Start the stdio MCP server\n  reposcope cursor-install               Install Cursor integration in the current project\n  reposcope cursor-install --project DIR Install Cursor integration in a specific project\n  reposcope cursor-install --global      Install Cursor integration globally\n  reposcope cursor-config                Print the Cursor MCP JSON snippet\n  reposcope help                         Show this help`);
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

const command = process.argv[2] ?? "mcp";

try {
  if (command === "cursor-install") {
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
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "mcp") {
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
