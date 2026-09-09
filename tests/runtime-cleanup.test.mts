import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  cleanupRuntimeInstallGarbage,
  STALE_RUNTIME_TEMP_MS,
} from "../src/runtime-cleanup.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("runtime cleanup removes only stale installer garbage and preserves current runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-cleanup-"));
  const runtimeRoot = join(root, "runtime");
  const current = join(runtimeRoot, "current");
  const oldInstall = join(runtimeRoot, ".install-old");
  const oldCache = join(runtimeRoot, ".npm-cache-old");
  const oldPrevious = join(runtimeRoot, ".previous-old");
  const freshInstall = join(runtimeRoot, ".install-fresh");
  const unrelated = join(runtimeRoot, "keep-me");
  const now = Date.now();

  try {
    for (const path of [current, oldInstall, oldCache, oldPrevious, freshInstall, unrelated]) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "marker.txt"), "keep\n", "utf8");
    }

    const oldTime = new Date(now - STALE_RUNTIME_TEMP_MS - 10_000);
    for (const path of [oldInstall, oldCache, oldPrevious]) {
      await utimes(path, oldTime, oldTime);
    }

    const result = await cleanupRuntimeInstallGarbage(
      { env: { REPOSCOPE_RUNTIME_DIR: runtimeRoot } },
      now,
    );

    assert.equal(result.removedInstallDirs, 1);
    assert.equal(result.removedCacheDirs, 1);
    assert.equal(result.removedPreviousDirs, 1);
    assert.equal(await exists(oldInstall), false);
    assert.equal(await exists(oldCache), false);
    assert.equal(await exists(oldPrevious), false);
    assert.equal(await exists(freshInstall), true);
    assert.equal(await exists(current), true);
    assert.equal(await exists(unrelated), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
