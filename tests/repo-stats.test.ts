import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildRepoStats } from "../src/repo-stats.js";

test("repo stats explains the same byte-over-four repository baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-repo-stats-"));

  try {
    await mkdir(join(root, "src", "generated"), { recursive: true });
    await writeFile(join(root, "root.ts"), Buffer.alloc(8, "a"));
    await writeFile(join(root, "src", "app.ts"), Buffer.alloc(12, "b"));
    await writeFile(
      join(root, "src", "generated", "schema.ts"),
      Buffer.alloc(40, "c"),
    );

    // Scanner exclusions must not inflate the explainable baseline.
    await writeFile(join(root, "ignored.png"), Buffer.alloc(400, 1));
    await writeFile(join(root, "package-lock.json"), Buffer.alloc(400, "x"));

    const report = await buildRepoStats(root);

    assert.equal(report.readableFiles, 3);
    assert.equal(report.readableBytes, 60);
    assert.equal(report.estimatedWholeRepoTokens, 15);
    assert.equal(
      report.estimation.method,
      "ceil(file_bytes / 4), summed across AI-readable files",
    );

    assert.deepEqual(
      report.topDirectories.map((entry) => [entry.path, entry.estimatedTokens]),
      [
        ["src/generated", 10],
        ["src", 3],
        ["(root)", 2],
      ],
    );
    assert.equal(report.largestFiles[0]?.path, "src/generated/schema.ts");
    assert.equal(report.largestFiles[0]?.estimatedTokens, 10);
    assert.equal(report.largestFiles[0]?.percentOfEstimatedTokens, 66.67);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
