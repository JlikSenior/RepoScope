import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { getProjectStatePaths } from "../src/state.js";

const execFileAsync = promisify(execFile);

type TextToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: string; [key: string]: unknown }
  >;
  isError?: boolean;
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createProject(path: string, marker: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await writeFile(join(path, "source.ts"), `export const marker = "${marker}";\n`, "utf8");
  await execFileAsync("git", ["add", "."], { cwd: path });
}

function makeClient(
  name: string,
  projectRoot: string,
  stateRoot: string,
): { client: Client; transport: StdioClientTransport } {
  const client = new Client({ name, version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "bin.mjs"), "mcp", "--project", projectRoot],
    env: cleanEnv({ REPOSCOPE_STATE_DIR: stateRoot }),
  });
  return { client, transport };
}

test("two same-named project MCP processes stay hard-isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-mcp-hard-isolation-"));
  const projectA = join(root, "owner-a", "same-name");
  const projectB = join(root, "owner-b", "same-name");
  const stateRoot = join(root, "state");

  await createProject(projectA, "marker_a");
  await createProject(projectB, "marker_b");

  const a = makeClient("reposcope-project-a", projectA, stateRoot);
  const b = makeClient("reposcope-project-b", projectB, stateRoot);

  try {
    await Promise.all([
      a.client.connect(a.transport),
      b.client.connect(b.transport),
    ]);

    const [startAResult, startBResult] = await Promise.all([
      a.client.callTool({
        name: "repo_session_start",
        arguments: {
          targetPath: projectA,
          task: "inspect A",
          budgetTokens: 5000,
        },
      }),
      b.client.callTool({
        name: "repo_session_start",
        arguments: {
          targetPath: projectB,
          task: "inspect B",
          budgetTokens: 5000,
        },
      }),
    ]);

    const startedA = JSON.parse(textFrom(startAResult as TextToolResult)) as {
      sessionId: string;
    };
    const startedB = JSON.parse(textFrom(startBResult as TextToolResult)) as {
      sessionId: string;
    };
    assert.notEqual(startedA.sessionId, startedB.sessionId);

    const [searchA, searchB] = await Promise.all([
      a.client.callTool({
        name: "repo_search",
        arguments: {
          targetPath: projectA,
          searchTerms: ["marker_a"],
          sessionId: startedA.sessionId,
        },
      }),
      b.client.callTool({
        name: "repo_search",
        arguments: {
          targetPath: projectB,
          searchTerms: ["marker_b"],
          sessionId: startedB.sessionId,
        },
      }),
    ]);

    assert.match(textFrom(searchA as TextToolResult), /source\.ts/);
    assert.match(textFrom(searchB as TextToolResult), /source\.ts/);

    let crossProjectBlocked = false;
    try {
      const wrong = (await a.client.callTool({
        name: "repo_session_start",
        arguments: {
          targetPath: projectB,
          task: "must be rejected",
          budgetTokens: 1000,
        },
      })) as TextToolResult;
      crossProjectBlocked =
        wrong.isError === true || /different project/.test(textFrom(wrong));
    } catch (error) {
      crossProjectBlocked = /different project|bound/i.test(String(error));
    }
    assert.equal(crossProjectBlocked, true);

    const options = { env: { REPOSCOPE_STATE_DIR: stateRoot } };
    const pathsA = await getProjectStatePaths(projectA, options);
    const pathsB = await getProjectStatePaths(projectB, options);
    assert.notEqual(pathsA.projectId, pathsB.projectId);
    assert.equal(await exists(join(stateRoot, "active")), false);
    assert.equal(
      await exists(join(pathsA.activeSessionsDir, `${startedA.sessionId}.json`)),
      true,
    );
    assert.equal(
      await exists(join(pathsB.activeSessionsDir, `${startedB.sessionId}.json`)),
      true,
    );

    await Promise.all([
      a.client.callTool({
        name: "repo_session_finish",
        arguments: { sessionId: startedA.sessionId, outcome: "success" },
      }),
      b.client.callTool({
        name: "repo_session_finish",
        arguments: { sessionId: startedB.sessionId, outcome: "success" },
      }),
    ]);
  } finally {
    await Promise.allSettled([a.client.close(), b.client.close()]);
    await rm(root, { recursive: true, force: true });
  }
});
