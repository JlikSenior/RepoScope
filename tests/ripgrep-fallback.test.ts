import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  invalidateDirectoryScan,
  scanDirectoryEntries,
} from "../src/scanner";
import { searchFiles } from "../src/search";
import { startSession } from "../src/sessions";

const execFileAsync = promisify(execFile);

test("RepoScope falls back to Git/Node when ripgrep is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-no-rg-"));
  const previousRgPath = process.env.REPOSCOPE_RG_PATH;

  try {
    process.env.REPOSCOPE_RG_PATH = join(root, "definitely-missing-rg");
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, ".gitignore"), "ignored.ts\n", "utf8");
    await writeFile(
      join(root, "alpha.ts"),
      "first line\nAlpha marker\nBeta marker\n",
      "utf8",
    );
    await writeFile(join(root, "beta.ts"), "alpha only\n", "utf8");
    await writeFile(join(root, "ignored.ts"), "Alpha marker Beta marker\n", "utf8");
    await writeFile(join(root, "package-lock.json"), "Alpha marker Beta marker\n", "utf8");

    invalidateDirectoryScan(root);
    const entries = await scanDirectoryEntries(root);
    const names = entries.map((entry) => basename(entry.path)).sort();

    assert(names.includes("alpha.ts"));
    assert(names.includes("beta.ts"));
    assert(names.includes(".gitignore"));
    assert(!names.includes("ignored.ts"));
    assert(!names.includes("package-lock.json"));

    const results = await searchFiles(root, ["alpha", "beta"]);
    assert.equal(results[0]?.path.endsWith("alpha.ts"), true);
    assert.equal(results[0]?.score, 2);
    assert.deepEqual(results[0]?.matches, [
      { line: 2, term: "alpha" },
      { line: 3, term: "beta" },
    ]);
    assert.equal(results[1]?.path.endsWith("beta.ts"), true);
    assert.equal(results[1]?.score, 1);

    const started = await startSession({
      targetPath: root,
      task: "verify no-rg startup",
      budgetTokens: 1000,
    });
    assert(started.wholeRepoTokens > 0);
  } finally {
    if (previousRgPath === undefined) {
      delete process.env.REPOSCOPE_RG_PATH;
    } else {
      process.env.REPOSCOPE_RG_PATH = previousRgPath;
    }
    await rm(root, { recursive: true, force: true });
  }
});
