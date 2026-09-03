import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { buildContext, readRepo } from "../src/core";
import { startSession } from "../src/sessions";

const execFileAsync = promisify(execFile);

test("partial repo_read prevents repo_context from redelivering the whole file", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-range-cross-tool-"));

  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    const lines = Array.from({ length: 300 }, (_, index) =>
      index + 1 === 150
        ? "export const CROSS_TOOL_NEEDLE = true;"
        : `export const value${index + 1} = ${index + 1};`,
    );
    await writeFile(join(root, "large.ts"), `${lines.join("\n")}\n`, "utf8");

    const session = await startSession({
      targetPath: root,
      task: "inspect cross-tool dedup",
      budgetTokens: 20000,
    });

    const read = await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 140, endLine: 160 }],
      budgetTokens: 5000,
      sessionId: session.sessionId,
    });
    const usedAfterRead = read.session?.usedTokens;
    assert((usedAfterRead ?? 0) > 0);

    const context = await buildContext({
      targetPath: root,
      task: "inspect cross-tool dedup",
      searchTerms: ["CROSS_TOOL_NEEDLE"],
      fileHints: ["large.ts"],
      budgetTokens: 10000,
      sessionId: session.sessionId,
    });

    assert.equal(context.selectedFiles.length, 0);
    assert.equal(context.skippedFiles[0]?.path, "large.ts");
    assert.equal(context.skippedFiles[0]?.reason, "already_read");
    assert.equal(context.session?.usedTokens, usedAfterRead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
