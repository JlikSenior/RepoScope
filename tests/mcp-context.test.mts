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

test("stdio repo_context delivers a bounded fragment for a large search hit", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-mcp-context-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-mcp-context-state-"));
  const lines = Array.from({ length: 500 }, (_, index) => {
    const line = index + 1;
    if (line === 300) return "mcp_context_marker";
    return `line-${String(line).padStart(3, "0")}`;
  });

  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "large.ts"), lines.join("\n"), "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });

  const client = new Client({
    name: "reposcope-context-test",
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp.mts"],
    env: cleanEnv({ REPOSCOPE_STATE_DIR: stateRoot }),
  });

  try {
    await client.connect(transport);

    const startResult = await client.callTool({
      name: "repo_session_start",
      arguments: {
        targetPath: root,
        task: "inspect large context marker",
        budgetTokens: 10000,
      },
    });
    const started = JSON.parse(textFrom(startResult as TextToolResult)) as {
      sessionId: string;
    };

    const contextResult = await client.callTool({
      name: "repo_context",
      arguments: {
        targetPath: root,
        task: "inspect large context marker",
        searchTerms: ["mcp_context_marker"],
        budgetTokens: 5000,
        sessionId: started.sessionId,
      },
    });
    const payload = JSON.parse(textFrom(contextResult as TextToolResult)) as {
      contextPacket: string;
      selectedFiles: string[];
    };

    assert.deepEqual(payload.selectedFiles, ["large.ts"]);
    assert.match(payload.contextPacket, /large\.ts \(L260-340 of 500\)/);
    assert.match(payload.contextPacket, /mcp_context_marker/);
    assert.doesNotMatch(payload.contextPacket, /line-001/);
    assert.doesNotMatch(payload.contextPacket, /line-500/);

    const finishResult = await client.callTool({
      name: "repo_session_finish",
      arguments: {
        sessionId: started.sessionId,
        outcome: "success",
      },
    });
    const report = JSON.parse(textFrom(finishResult as TextToolResult)) as {
      metrics: { sourceLinesRead: number; uniqueFilesRead: number };
    };

    assert.equal(report.metrics.sourceLinesRead, 81);
    assert.equal(report.metrics.uniqueFilesRead, 1);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
