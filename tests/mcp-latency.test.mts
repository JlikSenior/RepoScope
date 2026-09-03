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

function cleanEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

test("stdio MCP finish report exposes tool and component latency", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-mcp-latency-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(
    join(root, "sample.ts"),
    "export const alpha = true;\nexport const beta = true;\n",
    "utf8",
  );
  await execFileAsync("git", ["add", "."], { cwd: root });

  const client = new Client({
    name: "reposcope-latency-test",
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp.mts"],
    env: cleanEnv(),
  });

  try {
    await client.connect(transport);

    const startResult = await client.callTool({
      name: "repo_session_start",
      arguments: {
        targetPath: root,
        task: "inspect alpha",
        budgetTokens: 1000,
      },
    });
    const started = JSON.parse(textFrom(startResult as TextToolResult)) as {
      sessionId: string;
    };

    await client.callTool({
      name: "repo_search",
      arguments: {
        targetPath: root,
        searchTerms: ["alpha", "beta"],
        sessionId: started.sessionId,
      },
    });

    await client.callTool({
      name: "repo_read",
      arguments: {
        targetPath: root,
        ranges: [{ path: "sample.ts", startLine: 1, endLine: 1 }],
        budgetTokens: 500,
        sessionId: started.sessionId,
      },
    });

    const finishResult = await client.callTool({
      name: "repo_session_finish",
      arguments: {
        sessionId: started.sessionId,
        outcome: "success",
      },
    });
    const report = JSON.parse(textFrom(finishResult as TextToolResult)) as {
      metrics: {
        latency?: {
          repoSessionStart: { count: number; averageMs: number };
          repoSearch: { count: number; averageMs: number };
          repoRead: { count: number; averageMs: number };
          scan: {
            calls: number;
            cacheHits: number;
            cacheMisses: number;
            cacheHitPercent: number;
          };
          searchRg: { runs: number; averageRunMs: number };
        };
      };
    };

    const latency = report.metrics.latency;
    assert(latency);
    assert.equal(latency.repoSessionStart.count, 1);
    assert.equal(latency.repoSearch.count, 1);
    assert.equal(latency.repoRead.count, 1);
    assert(latency.repoSessionStart.averageMs >= 0);
    assert(latency.repoSearch.averageMs >= 0);
    assert(latency.repoRead.averageMs >= 0);
    assert(latency.scan.calls >= 2);
    assert(latency.scan.cacheMisses >= 1);
    assert(latency.scan.cacheHits >= 1);
    assert(latency.scan.cacheHitPercent > 0);
    assert.equal(latency.searchRg.runs, 1);
    assert(latency.searchRg.averageRunMs >= 0);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
