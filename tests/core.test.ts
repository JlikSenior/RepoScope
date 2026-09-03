import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import { buildContext, readRepo, searchRepo } from "../src/core";
import { scanDirectory } from "../src/scanner";
import { startSession } from "../src/sessions";

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
