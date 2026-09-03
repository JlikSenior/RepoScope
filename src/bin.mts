#!/usr/bin/env node

import {
  buildCursorMcpSnippet,
  DEFAULT_NPX_SPEC,
  installCursorIntegration,
} from "./cursor-setup.mjs";

function printHelp(): void {
  console.log(`RepoScope\n\nUsage:\n  reposcope                 Start the stdio MCP server\n  reposcope mcp             Start the stdio MCP server\n  reposcope cursor-install  Install Cursor global MCP config and RepoScope skills\n  reposcope cursor-config   Print the Cursor MCP JSON snippet\n  reposcope help            Show this help`);
}

const command = process.argv[2] ?? "mcp";

try {
  if (command === "cursor-install") {
    const result = await installCursorIntegration();

    console.log("RepoScope Cursor integration installed.");
    console.log(`MCP config: ${result.mcpConfigPath}`);
    for (const skillPath of result.skillPaths) {
      console.log(`Skill: ${skillPath}`);
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
