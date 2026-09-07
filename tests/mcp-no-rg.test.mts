import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const execFileAsync = promisify(execFile);

type TextToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: string; [key: string]: unknown }
  >;
};

function textFrom(result: TextToolResult): string {
  const block = result.content.find((item) => item.type === "text");
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Tool did not return text");
  }
  return block.text;
}

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    ...extra,
  };
}

test("stdio MCP starts and searches when ripgrep is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-mcp-no-rg-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-mcp-no-rg-state-"));

  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "sample.ts"), "export const windows_marker = true;\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });

  const client = new Client({
    name: "reposcope-no-rg-test",
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["tsx", "src/mcp.mts"],
    env: cleanEnv({
      REPOSCOPE_STATE_DIR: stateRoot,
      REPOSCOPE_RG_PATH: join(root, "missing-rg-executable"),
    }),
  });

  try {
    await client.connect(transport);

    const startResult = await client.callTool({
      name: "repo_session_start",
      arguments: {
        targetPath: root,
        task: "verify portable startup",
        budgetTokens: 2000,
      },
    });
    const started = JSON.parse(textFrom(startResult as TextToolResult)) as {
      sessionId: string;
    };
    assert(started.sessionId);

    const searchResult = await client.callTool({
      name: "repo_search",
      arguments: {
        targetPath: root,
        searchTerms: ["windows_marker"],
        sessionId: started.sessionId,
      },
    });
    const searched = JSON.parse(textFrom(searchResult as TextToolResult)) as {
      results: Array<{ path: string; matches: Array<{ line: number; term: string }> }>;
    };

    assert.equal(searched.results[0]?.path, "sample.ts");
    assert.deepEqual(searched.results[0]?.matches, [
      { line: 1, term: "windows_marker" },
    ]);

    await client.callTool({
      name: "repo_session_finish",
      arguments: {
        sessionId: started.sessionId,
        outcome: "success",
      },
    });
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
