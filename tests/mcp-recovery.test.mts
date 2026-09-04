import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

async function connectClient(stateRoot: string, suffix: string): Promise<Client> {
  const client = new Client({
    name: `reposcope-recovery-${suffix}`,
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp.mts"],
    env: cleanEnv({ REPOSCOPE_STATE_DIR: stateRoot }),
  });
  await client.connect(transport);
  return client;
}

test("stdio MCP restores an active session after the server process restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-recovery-project-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-recovery-state-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(
    join(root, "sample.ts"),
    "export const alpha = true;\nexport const beta = true;\n",
    "utf8",
  );
  await execFileAsync("git", ["add", "."], { cwd: root });

  let first: Client | undefined;
  let second: Client | undefined;

  try {
    first = await connectClient(stateRoot, "first");

    const startResult = await first.callTool({
      name: "repo_session_start",
      arguments: {
        targetPath: root,
        task: "recover an interrupted inspection",
        budgetTokens: 2000,
      },
    });
    const started = JSON.parse(textFrom(startResult as TextToolResult)) as {
      sessionId: string;
    };

    await first.callTool({
      name: "repo_search",
      arguments: {
        targetPath: root,
        searchTerms: ["alpha"],
        sessionId: started.sessionId,
      },
    });
    await first.callTool({
      name: "repo_read",
      arguments: {
        targetPath: root,
        ranges: [{ path: "sample.ts", startLine: 1, endLine: 1 }],
        budgetTokens: 500,
        sessionId: started.sessionId,
      },
    });

    const beforeRestartResult = await first.callTool({
      name: "repo_session_status",
      arguments: { sessionId: started.sessionId },
    });
    const beforeRestart = JSON.parse(
      textFrom(beforeRestartResult as TextToolResult),
    ) as {
      usedTokens: number;
      deliveredTokens: number;
      searchCount: number;
      readRanges: Record<string, Array<{ startLine: number; endLine: number }>>;
    };

    assert(beforeRestart.usedTokens > 0);
    assert.equal(beforeRestart.searchCount, 1);
    assert.deepEqual(beforeRestart.readRanges["sample.ts"], [
      { startLine: 1, endLine: 1 },
    ]);

    await first.close();
    first = undefined;

    const locatorFiles = await readdir(join(stateRoot, "active"));
    assert(locatorFiles.includes(`${started.sessionId}.json`));

    // This is a fresh stdio child process with an empty in-memory Session map.
    second = await connectClient(stateRoot, "second");

    const recoveredStatusResult = await second.callTool({
      name: "repo_session_status",
      arguments: { sessionId: started.sessionId },
    });
    const recovered = JSON.parse(
      textFrom(recoveredStatusResult as TextToolResult),
    ) as {
      status: string;
      usedTokens: number;
      deliveredTokens: number;
      searchCount: number;
      readRanges: Record<string, Array<{ startLine: number; endLine: number }>>;
    };

    assert.equal(recovered.status, "active");
    assert.equal(recovered.usedTokens, beforeRestart.usedTokens);
    assert.equal(recovered.deliveredTokens, beforeRestart.deliveredTokens);
    assert.equal(recovered.searchCount, 1);
    assert.deepEqual(recovered.readRanges["sample.ts"], [
      { startLine: 1, endLine: 1 },
    ]);

    const duplicateRead = await second.callTool({
      name: "repo_read",
      arguments: {
        targetPath: root,
        ranges: [{ path: "sample.ts", startLine: 1, endLine: 1 }],
        budgetTokens: 500,
        sessionId: started.sessionId,
      },
    });
    assert.match(
      textFrom(duplicateRead as TextToolResult),
      /SKIP sample\.ts L1-1 already_read/,
    );

    const finishResult = await second.callTool({
      name: "repo_session_finish",
      arguments: {
        sessionId: started.sessionId,
        outcome: "success",
        note: "recovered after MCP restart",
      },
    });
    const finished = JSON.parse(textFrom(finishResult as TextToolResult)) as {
      outcome: string;
      metrics: { status: string; searchCount: number };
    };
    assert.equal(finished.outcome, "success");
    assert.equal(finished.metrics.status, "finished");
    assert.equal(finished.metrics.searchCount, 1);

    assert.deepEqual(await readdir(join(stateRoot, "active")), []);
    const projects = await readdir(join(stateRoot, "projects"));
    assert.equal(projects.length, 1);
    assert.deepEqual(
      await readdir(join(stateRoot, "projects", projects[0], "active")),
      [],
    );
    assert.deepEqual(
      await readdir(join(stateRoot, "projects", projects[0], "sessions")),
      [`${started.sessionId}.json`],
    );
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
