import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  invalidateDirectoryScan,
  scanDirectoryEntries,
} from "../src/scanner";

const execFileAsync = promisify(execFile);

test("repository scans are reused briefly and can be invalidated after writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-scan-cache-"));

  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "one.ts"), "export const one = 1;\n", "utf8");

    const first = await scanDirectoryEntries(root);
    assert(first.some((entry) => entry.path === join(root, "one.ts")));

    await writeFile(join(root, "two.ts"), "export const two = 2;\n", "utf8");

    const cached = await scanDirectoryEntries(root);
    assert.equal(cached, first);
    assert(!cached.some((entry) => entry.path === join(root, "two.ts")));

    invalidateDirectoryScan(root);
    const refreshed = await scanDirectoryEntries(root);
    assert.notEqual(refreshed, first);
    assert(refreshed.some((entry) => entry.path === join(root, "two.ts")));
  } finally {
    invalidateDirectoryScan(root);
    await rm(root, { recursive: true, force: true });
  }
});
