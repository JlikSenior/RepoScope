import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { MAX_READ_RANGE_LINES, readRepo, searchRepo } from "../src/core";
import { getSession, startSession } from "../src/sessions";
import { applySessionPatch } from "../src/write";

const execFileAsync = promisify(execFile);

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reposcope-range-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });

  const lines = Array.from({ length: 800 }, (_, index) => {
    const line = index + 1;
    if (line === 320) return "export const NEEDLE_ALPHA = true;";
    if (line === 330) return "export const NEEDLE_BETA = true;";
    return `export const line${line} = ${line};`;
  });

  await writeFile(join(root, "large.ts"), `${lines.join("\n")}\n`, "utf8");
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

test("repo_search returns bounded match line hints", async () => {
  const root = await createFixture();

  try {
    const result = await searchRepo({
      targetPath: root,
      searchTerms: ["NEEDLE_ALPHA", "NEEDLE_BETA"],
      limit: 5,
    });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].path, "large.ts");
    assert.deepEqual(
      result.results[0].matches.map((match) => match.line),
      [320, 330],
    );
    assert(result.results[0].estimatedTokens > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo_read charges only the requested line range", async () => {
  const root = await createFixture();

  try {
    const session = await startSession({
      targetPath: root,
      task: "inspect matching code",
      budgetTokens: 10000,
    });

    const result = await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 310, endLine: 340 }],
      budgetTokens: 10000,
      sessionId: session.sessionId,
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].startLine, 310);
    assert.equal(result.files[0].endLine, 340);
    assert.equal(result.files[0].complete, false);
    assert.match(result.files[0].content, /NEEDLE_ALPHA/);
    assert.match(result.files[0].content, /NEEDLE_BETA/);
    assert.doesNotMatch(result.files[0].content, /line100 = 100/);
    assert(result.files[0].tokens < session.wholeRepoTokens);
    assert.equal(result.session?.usedTokens, result.files[0].tokens);

    const stored = getSession(session.sessionId);
    assert(stored);
    assert.deepEqual(stored.readRanges["large.ts"], [
      { startLine: 310, endLine: 340 },
    ]);
    assert.equal(stored.fullyReadFiles["large.ts"], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlapping range reads deliver and charge only unseen lines", async () => {
  const root = await createFixture();

  try {
    const session = await startSession({
      targetPath: root,
      task: "inspect overlapping code",
      budgetTokens: 10000,
    });

    const first = await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 300, endLine: 330 }],
      budgetTokens: 10000,
      sessionId: session.sessionId,
    });
    const usedAfterFirst = first.session?.usedTokens ?? 0;

    const second = await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 320, endLine: 350 }],
      budgetTokens: 10000,
      sessionId: session.sessionId,
    });

    assert.equal(second.files.length, 1);
    assert.equal(second.files[0].startLine, 331);
    assert.equal(second.files[0].endLine, 350);
    assert.doesNotMatch(second.files[0].content, /NEEDLE_ALPHA/);
    assert((second.session?.usedTokens ?? 0) > usedAfterFirst);

    const third = await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 305, endLine: 345 }],
      budgetTokens: 10000,
      sessionId: session.sessionId,
    });

    assert.equal(third.files.length, 0);
    assert.equal(third.skippedFiles[0]?.reason, "already_read");
    assert.equal(third.session?.usedTokens, second.session?.usedTokens);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo_read rejects oversized line ranges", async () => {
  const root = await createFixture();

  try {
    await assert.rejects(
      readRepo({
        targetPath: root,
        ranges: [
          {
            path: "large.ts",
            startLine: 1,
            endLine: MAX_READ_RANGE_LINES + 1,
          },
        ],
        budgetTokens: 10000,
      }),
      new RegExp(`exceeds ${MAX_READ_RANGE_LINES} lines`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("partial range reads do not unlock guarded whole-file patches", async () => {
  const root = await createFixture();

  try {
    const session = await startSession({
      targetPath: root,
      task: "change matching code",
      budgetTokens: 20000,
    });

    await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 315, endLine: 325 }],
      budgetTokens: 10000,
      sessionId: session.sessionId,
    });

    const patch = [
      "--- a/large.ts",
      "+++ b/large.ts",
      "@@ -320 +320 @@",
      "-export const NEEDLE_ALPHA = true;",
      "+export const NEEDLE_ALPHA = false;",
      "",
    ].join("\n");

    await assert.rejects(
      applySessionPatch({
        targetPath: root,
        patch,
        sessionId: session.sessionId,
      }),
      /must be fully read before RepoScope patch modification/,
    );

    await readRepo({
      targetPath: root,
      files: ["large.ts"],
      budgetTokens: 20000,
      sessionId: session.sessionId,
    });

    const applied = await applySessionPatch({
      targetPath: root,
      patch,
      sessionId: session.sessionId,
    });
    assert.deepEqual(applied.files, ["large.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
