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

test("stdio MCP exposes and completes a local repository session", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-stdio-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "sample.ts"), "export const sample = true;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });

  const client = new Client({
    name: "reposcope-stdio-test",
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp.mts"],
  });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    assert(names.includes("repo_search"));
    assert(names.includes("repo_apply_patch"));
    assert(names.includes("repo_run"));
    assert(names.includes("repo_session_finish"));

    const startResult = await client.callTool({
      name: "repo_session_start",
      arguments: {
        targetPath: root,
        task: "inspect local fixture",
        budgetTokens: 500,
      },
    });
    const started = JSON.parse(textFrom(startResult as TextToolResult)) as {
      sessionId: string;
    };

    const finishResult = await client.callTool({
      name: "repo_session_finish",
      arguments: {
        sessionId: started.sessionId,
        outcome: "success",
      },
    });
    const report = JSON.parse(textFrom(finishResult as TextToolResult)) as {
      outcome: string;
      verification: { status: string };
      metrics: { status: string };
    };

    assert.equal(report.outcome, "success");
    assert.equal(report.verification.status, "not_run");
    assert.equal(report.metrics.status, "finished");

    const statusResult = await client.callTool({
      name: "repo_session_status",
      arguments: { sessionId: started.sessionId },
    });
    const status = JSON.parse(textFrom(statusResult as TextToolResult)) as {
      status: string;
      outcome: string;
    };

    assert.equal(status.status, "finished");
    assert.equal(status.outcome, "success");
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
