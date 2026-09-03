import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import { summarizeSession } from "../src/monitoring";
import {
  listAllowedCommands,
  runAllowedCommand,
} from "../src/runner";
import { getSession, startSession } from "../src/sessions";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];

async function createFixture(config: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runner-"));
  fixtures.push(root);

  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(
    join(root, ".reposcope.json"),
    JSON.stringify(config, null, 2),
  );
  await writeFile(join(root, "README.md"), "fixture\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=RepoScope Test",
      "-c",
      "user.email=reposcope@example.com",
      "commit",
      "-q",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );

  return root;
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((fixture) =>
      rm(fixture, { recursive: true, force: true }),
    ),
  );
});

test("runner lists only repository-allowlisted command names", async () => {
  const root = await createFixture({
    commands: {
      pass: ["node", "-e", "console.log('ok')"],
      check: ["node", "-e", "console.log('checked')"],
    },
  });
  const session = await startSession({
    targetPath: root,
    task: "run checks",
    budgetTokens: 1000,
  });

  const commands = await listAllowedCommands({
    targetPath: root,
    sessionId: session.sessionId,
  });

  assert.deepEqual(commands, ["check", "pass"]);
});

test("runner executes allowlisted commands without shell arguments from the agent", async () => {
  const root = await createFixture({
    commands: {
      pass: ["node", "-e", "console.log('runner ok')"],
    },
  });
  const session = await startSession({
    targetPath: root,
    task: "run checks",
    budgetTokens: 1000,
  });

  const result = await runAllowedCommand({
    targetPath: root,
    command: "pass",
    sessionId: session.sessionId,
    budgetTokens: 500,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /runner ok/);
  assert.equal(result.truncated, false);

  const stored = getSession(session.sessionId);
  assert(stored);
  const metrics = summarizeSession(stored);
  assert.equal(metrics.runCount, 1);
  assert.equal(metrics.failedRunCount, 0);
});

test("non-zero command exits are returned to the agent and recorded as failures", async () => {
  const root = await createFixture({
    commands: {
      fail: [
        "node",
        "-e",
        "console.error('expected failure'); process.exit(3)",
      ],
    },
  });
  const session = await startSession({
    targetPath: root,
    task: "run checks",
    budgetTokens: 1000,
  });

  const result = await runAllowedCommand({
    targetPath: root,
    command: "fail",
    sessionId: session.sessionId,
    budgetTokens: 500,
  });

  assert.equal(result.exitCode, 3);
  assert.match(result.output, /expected failure/);

  const stored = getSession(session.sessionId);
  assert(stored);
  const metrics = summarizeSession(stored);
  assert.equal(metrics.runCount, 1);
  assert.equal(metrics.failedRunCount, 1);
});

test("commands not present in .reposcope.json are rejected", async () => {
  const root = await createFixture({
    commands: {
      pass: ["node", "-e", "console.log('ok')"],
    },
  });
  const session = await startSession({
    targetPath: root,
    task: "run checks",
    budgetTokens: 1000,
  });

  await assert.rejects(
    runAllowedCommand({
      targetPath: root,
      command: "anything-you-want",
      sessionId: session.sessionId,
      budgetTokens: 500,
    }),
    /Command is not allowlisted/,
  );
});

test("unsafe executable paths in repository config are rejected", async () => {
  const root = await createFixture({
    commands: {
      unsafe: ["../bin/tool"],
    },
  });
  const session = await startSession({
    targetPath: root,
    task: "run checks",
    budgetTokens: 1000,
  });

  await assert.rejects(
    listAllowedCommands({
      targetPath: root,
      sessionId: session.sessionId,
    }),
    /Unsafe executable/,
  );
});

test("runner output obeys its token budget", async () => {
  const root = await createFixture({
    commands: {
      noisy: [
        "node",
        "-e",
        "console.log('word '.repeat(1000))",
      ],
    },
  });
  const session = await startSession({
    targetPath: root,
    task: "run checks",
    budgetTokens: 1000,
  });

  const result = await runAllowedCommand({
    targetPath: root,
    command: "noisy",
    sessionId: session.sessionId,
    budgetTokens: 32,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.outputTokens, 32);
});
