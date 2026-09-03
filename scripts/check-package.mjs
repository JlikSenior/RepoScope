import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({
  name: "reposcope-package-check",
  version: "0.1.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/bin.mjs"],
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);

  assert(names.includes("repo_session_start"));
  assert(names.includes("repo_search"));
  assert(names.includes("repo_read"));
  assert(names.includes("repo_session_finish"));
} finally {
  await client.close();
}

console.log("Compiled RepoScope package runtime OK");
