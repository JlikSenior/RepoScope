import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import { readRepo } from "../src/core";
import {
  buildSessionFinishReport,
  summarizeSession,
} from "../src/monitoring";
import { runAllowedCommand } from "../src/runner";
import {
  finishSession,
  getSession,
  getSessionRecord,
  startSession,
} from "../src/sessions";
import { applySessionPatch } from "../src/write";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reposcope-finish-"));
  fixtures.push(root);

  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src/value.ts"),
    'export const value = "before";\n',
  );
  await writeFile(
    join(root, ".reposcope.json"),
    JSON.stringify({
      commands: {
        verify: ["node", "-e", "process.exit(0)"],
      },
    }),
  );

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

test("finished session reports outcome separately from verification and locks work", async () => {
  const root = await createFixture();
  const started = await startSession({
    targetPath: root,
    task: "change value",
    budgetTokens: 1000,
  });

  await readRepo({
    targetPath: root,
    files: ["src/value.ts"],
    budgetTokens: 1000,
    sessionId: started.sessionId,
  });

  const patch = [
    "diff --git a/src/value.ts b/src/value.ts",
    "--- a/src/value.ts",
    "+++ b/src/value.ts",
    "@@ -1 +1 @@",
    '-export const value = "before";',
    '+export const value = "after";',
    "",
  ].join("\n");

  await applySessionPatch({
    targetPath: root,
    patch,
    sessionId: started.sessionId,
  });

  await runAllowedCommand({
    targetPath: root,
    command: "verify",
    sessionId: started.sessionId,
    budgetTokens: 200,
  });

  const finished = finishSession(
    started.sessionId,
    "success",
    "implementation complete",
  );
  const report = buildSessionFinishReport(finished);

  assert.equal(report.outcome, "success");
  assert.equal(report.verification.status, "passed");
  assert.equal(report.verification.command, "verify");
  assert.deepEqual(report.changedFiles, ["src/value.ts"]);
  assert.equal(report.metrics.status, "finished");
  assert.equal(report.metrics.runCount, 1);
  assert.equal(report.metrics.writeCount, 1);

  assert.throws(() => getSession(started.sessionId), /Session is finished/);
  assert.equal(getSessionRecord(started.sessionId)?.status, "finished");

  await assert.rejects(
    readRepo({
      targetPath: root,
      files: ["src/value.ts"],
      budgetTokens: 1000,
      sessionId: started.sessionId,
    }),
    /Session is finished/,
  );
});

test("agent-reported success is not treated as verified when no command ran", async () => {
  const root = await createFixture();
  const started = await startSession({
    targetPath: root,
    task: "inspect only",
    budgetTokens: 1000,
  });

  const finished = finishSession(started.sessionId, "success");
  const report = buildSessionFinishReport(finished);

  assert.equal(report.outcome, "success");
  assert.equal(report.verification.status, "not_run");
  assert.equal(summarizeSession(finished).status, "finished");
});
