import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectToolPerformance } from "../src/performance";
import {
  invalidateDirectoryScan,
  scanDirectoryEntries,
} from "../src/scanner";
import { searchFiles } from "../src/search";

test("performance collection distinguishes scan cache hits and ripgrep runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-performance-"));

  try {
    await writeFile(
      join(root, "sample.ts"),
      "export const alpha = true;\nexport const beta = true;\n",
      "utf8",
    );
    invalidateDirectoryScan(root);

    const measured = await collectToolPerformance(async () => {
      await scanDirectoryEntries(root);
      await scanDirectoryEntries(root);
      await searchFiles(root, ["alpha", "beta"]);
      return "ok";
    });

    assert.equal(measured.error, undefined);
    assert.equal(measured.value, "ok");
    assert.equal(measured.sample.failed, false);
    assert(measured.sample.durationMs >= 0);
    assert.equal(measured.sample.scan.calls, 2);
    assert.equal(measured.sample.scan.cacheMisses, 1);
    assert.equal(measured.sample.scan.cacheHits, 1);
    assert.equal(measured.sample.searchRg.runs, 1);
    assert(measured.sample.searchRg.totalMs >= 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("performance collection records failed tool calls without swallowing errors", async () => {
  const measured = await collectToolPerformance(async () => {
    throw new Error("expected failure");
  });

  assert.equal(measured.sample.failed, true);
  assert(measured.error instanceof Error);
  assert.equal((measured.error as Error).message, "expected failure");
});
