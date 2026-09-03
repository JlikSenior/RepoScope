import assert from "node:assert/strict";
import { test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createRepoScopeServer } from "../src/mcp.mjs";

test("HTTP MCP handler exposes RepoScope tools", async () => {
  const handler = createMcpHandler(createRepoScopeServer);
  const client = new Client({ name: "http-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("http://local.test/mcp"),
    { fetch: (url, init) => handler.fetch(new Request(url, init)) },
  );

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    assert(names.includes("repo_search"));
    assert(names.includes("repo_read"));
    assert(names.includes("repo_apply_patch"));
  } finally {
    await client.close();
    await handler.close();
  }
});
