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

test("stdio MCP exposes search line hints and ranged repo_read", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-mcp-range-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-mcp-range-state-"));

  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    const lines = Array.from({ length: 240 }, (_, index) =>
      index + 1 === 120
        ? "export const MCP_RANGE_NEEDLE = true;"
        : `export const item${index + 1} = ${index + 1};`,
    );
    await writeFile(join(root, "large.ts"), `${lines.join("\n")}\n`, "utf8");

    const client = new Client({ name: "reposcope-range-test", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/mcp.mts"],
      env: cleanEnv({ REPOSCOPE_STATE_DIR: stateRoot }),
    });

    await client.connect(transport);
    try {
      const startResult = await client.callTool({
        name: "repo_session_start",
        arguments: {
          targetPath: root,
          task: "inspect ranged MCP source",
          budgetTokens: 5000,
        },
      });
      const started = JSON.parse(textFrom(startResult as TextToolResult)) as {
        sessionId: string;
      };

      const searchResult = await client.callTool({
        name: "repo_search",
        arguments: {
          targetPath: root,
          searchTerms: ["MCP_RANGE_NEEDLE"],
          limit: 5,
          sessionId: started.sessionId,
        },
      });
      const search = JSON.parse(textFrom(searchResult as TextToolResult)) as {
        results: Array<{ path: string; matches: Array<{ line: number }> }>;
      };
      assert.equal(search.results[0].path, "large.ts");
      assert.equal(search.results[0].matches[0].line, 120);

      const readResult = await client.callTool({
        name: "repo_read",
        arguments: {
          targetPath: root,
          ranges: [{ path: "large.ts", startLine: 110, endLine: 130 }],
          budgetTokens: 3000,
          sessionId: started.sessionId,
        },
      });
      const readText = textFrom(readResult as TextToolResult);
      assert.match(readText, /FILE large\.ts L110-130/);
      assert.match(readText, /MCP_RANGE_NEEDLE/);
      assert.doesNotMatch(readText, /item20 = 20/);

      await client.callTool({
        name: "repo_session_finish",
        arguments: { sessionId: started.sessionId, outcome: "success" },
      });
    } finally {
      await client.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
