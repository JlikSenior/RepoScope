import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import { buildContext, readRepo, searchRepo } from "../src/core";
import { summarizeSession } from "../src/monitoring";
import { scanDirectory } from "../src/scanner";
import { getSession, startSession } from "../src/sessions";
import {
  applySessionPatch,
  getSessionRepoDiff,
  getSessionRepoStatus,
} from "../src/write";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reposcope-test-"));
  fixtures.push(root);

  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "ignored"), { recursive: true });

  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await writeFile(
    join(root, "src/payment.ts"),
    'import { getUser } from "./user";\n\nexport function processPayment() {\n  return getUser().name;\n}\n',
  );
  await writeFile(
    join(root, "src/user.ts"),
    'export function getUser() {\n  return { id: 1, name: "Alice" };\n}\n',
  );
  await writeFile(
    join(root, "src/feature.ts"),
    'export function feature() {\n  return "enabled";\n}\n',
  );
  await writeFile(
    join(root, "ignored/generated.ts"),
    'export const generated = "ignore me";\n',
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

test("scanner respects repository ignore rules", async () => {
  const root = await createFixture();
  const files = await scanDirectory(root);
  const relativeFiles = files.map((file) => relative(root, file));

  assert(relativeFiles.includes("src/payment.ts"));
  assert(relativeFiles.includes("src/user.ts"));
  assert(!relativeFiles.includes("ignored/generated.ts"));
});

test("repo search returns a bounded relative result set", async () => {
  const root = await createFixture();
  const result = await searchRepo({
    targetPath: root,
    searchTerms: ["export"],
    limit: 1,
  });

  assert.equal(result.results.length, 1);
  assert(!result.results[0].path.startsWith(root));
});

test("repo read does not charge or redeliver the same file twice", async () => {
  const root = await createFixture();
  const session = await startSession({
    targetPath: root,
    task: "inspect payment flow",
    budgetTokens: 1000,
  });

  const first = await readRepo({
    targetPath: root,
    files: ["src/payment.ts"],
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });

  assert.equal(first.files.length, 1);
  assert(first.session);
  const usedAfterFirstRead = first.session.usedTokens;
  assert(usedAfterFirstRead > 0);

  const second = await readRepo({
    targetPath: root,
    files: ["src/payment.ts"],
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });

  assert.equal(second.files.length, 0);
  assert.equal(second.skippedFiles[0]?.reason, "already_read");
  assert.equal(second.session?.usedTokens, usedAfterFirstRead);
});

test("context delivery participates in cross-tool deduplication", async () => {
  const root = await createFixture();
  const session = await startSession({
    targetPath: root,
    task: "inspect payment flow",
    budgetTokens: 1000,
  });

  const context = await buildContext({
    targetPath: root,
    task: "inspect payment flow",
    searchTerms: ["payment"],
    fileHints: ["src/payment.ts"],
    budgetTokens: 500,
    sessionId: session.sessionId,
  });

  assert.deepEqual(
    context.selectedFiles.map((file) => file.path),
    ["src/payment.ts"],
  );

  const read = await readRepo({
    targetPath: root,
    files: ["src/payment.ts"],
    budgetTokens: 500,
    sessionId: session.sessionId,
  });

  assert.equal(read.files.length, 0);
  assert.equal(read.skippedFiles[0]?.reason, "already_read");
});

test("session budget blocks source delivery without going negative", async () => {
  const root = await createFixture();
  const session = await startSession({
    targetPath: root,
    task: "tiny budget",
    budgetTokens: 1,
  });

  const read = await readRepo({
    targetPath: root,
    files: ["src/user.ts"],
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });

  assert.equal(read.files.length, 0);
  assert.equal(read.skippedFiles[0]?.reason, "context_budget_exceeded");
  assert.equal(read.session?.usedTokens, 0);
  assert.equal(read.session?.remainingTokens, 1);
});

test("existing files must be read before a patch can modify them", async () => {
  const root = await createFixture();
  const session = await startSession({
    targetPath: root,
    task: "change feature",
    budgetTokens: 1000,
  });
  const patch = [
    "diff --git a/src/feature.ts b/src/feature.ts",
    "--- a/src/feature.ts",
    "+++ b/src/feature.ts",
    "@@ -1,3 +1,3 @@",
    " export function feature() {",
    '-  return "enabled";',
    '+  return "disabled";',
    " }",
    "",
  ].join("\n");

  await assert.rejects(
    applySessionPatch({
      targetPath: root,
      patch,
      sessionId: session.sessionId,
    }),
    /Existing files must be read before modification/,
  );

  await readRepo({
    targetPath: root,
    files: ["src/feature.ts"],
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });

  const applied = await applySessionPatch({
    targetPath: root,
    patch,
    sessionId: session.sessionId,
  });

  assert.deepEqual(applied.files, ["src/feature.ts"]);

  const status = await getSessionRepoStatus({
    targetPath: root,
    sessionId: session.sessionId,
  });
  assert(status.lines.some((line) => line.includes("src/feature.ts")));

  const diff = await getSessionRepoDiff({
    targetPath: root,
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });
  assert.match(diff.diff, /return "disabled"/);
  assert.equal(diff.truncated, false);

  const storedSession = getSession(session.sessionId);
  assert(storedSession);
  assert.equal(summarizeSession(storedSession).writeCount, 1);
});

test("diff output obeys its token budget", async () => {
  const root = await createFixture();
  const session = await startSession({
    targetPath: root,
    task: "change feature",
    budgetTokens: 1000,
  });
  const patch = [
    "diff --git a/src/feature.ts b/src/feature.ts",
    "--- a/src/feature.ts",
    "+++ b/src/feature.ts",
    "@@ -1,3 +1,3 @@",
    " export function feature() {",
    '-  return "enabled";',
    '+  return "disabled";',
    " }",
    "",
  ].join("\n");

  await readRepo({
    targetPath: root,
    files: ["src/feature.ts"],
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });
  await applySessionPatch({
    targetPath: root,
    patch,
    sessionId: session.sessionId,
  });

  const diff = await getSessionRepoDiff({
    targetPath: root,
    budgetTokens: 1,
    sessionId: session.sessionId,
  });

  assert.equal(diff.truncated, true);
  assert.equal(diff.tokens, 1);
});

test("patch paths cannot escape the repository", async () => {
  const root = await createFixture();
  const session = await startSession({
    targetPath: root,
    task: "unsafe patch",
    budgetTokens: 1000,
  });
  const patch = [
    "diff --git a/../escape.ts b/../escape.ts",
    "--- a/../escape.ts",
    "+++ b/../escape.ts",
    "@@ -0,0 +1 @@",
    "+export const escaped = true;",
    "",
  ].join("\n");

  await assert.rejects(
    applySessionPatch({
      targetPath: root,
      patch,
      sessionId: session.sessionId,
    }),
    /Unsafe patch path/,
  );
});
