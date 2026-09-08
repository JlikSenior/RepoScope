import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  cleanupProjectRuntimeState,
  STALE_ACTIVE_SESSION_MS,
  STALE_ATOMIC_TEMP_MS,
} from "../src/state-cleanup.js";
import { ensureProjectState } from "../src/state.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("runtime cleanup removes only stale files from the requested project", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-state-cleanup-"));
  const projectA = join(root, "owner-a", "same-name");
  const projectB = join(root, "owner-b", "same-name");
  const stateRoot = join(root, "state");
  const options = { env: { REPOSCOPE_STATE_DIR: stateRoot } };
  const now = Date.now();

  try {
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    const pathsA = await ensureProjectState(projectA, options);
    const pathsB = await ensureProjectState(projectB, options);

    const staleA = join(pathsA.activeSessionsDir, "stale-a.json");
    const recentA = join(pathsA.activeSessionsDir, "recent-a.json");
    const staleTmpA = join(pathsA.activeSessionsDir, "checkpoint.tmp");
    const staleB = join(pathsB.activeSessionsDir, "stale-b.json");
    const legacyLocatorA = join(pathsA.activeIndexDir, "stale-a.json");

    await mkdir(pathsA.activeIndexDir, { recursive: true });
    await Promise.all([
      writeFile(staleA, "{}\n", "utf8"),
      writeFile(recentA, "{}\n", "utf8"),
      writeFile(staleTmpA, "partial", "utf8"),
      writeFile(staleB, "{}\n", "utf8"),
      writeFile(legacyLocatorA, "{}\n", "utf8"),
    ]);

    const oldActiveTime = new Date(now - STALE_ACTIVE_SESSION_MS - 1_000);
    const oldTmpTime = new Date(now - STALE_ATOMIC_TEMP_MS - 1_000);
    await utimes(staleA, oldActiveTime, oldActiveTime);
    await utimes(staleB, oldActiveTime, oldActiveTime);
    await utimes(staleTmpA, oldTmpTime, oldTmpTime);

    const result = await cleanupProjectRuntimeState(projectA, options, now);

    assert.deepEqual(result, {
      removedActiveSessions: 1,
      removedTempFiles: 1,
      removedLegacyLocators: 1,
    });
    assert.equal(await exists(staleA), false);
    assert.equal(await exists(staleTmpA), false);
    assert.equal(await exists(legacyLocatorA), false);
    assert.equal(await exists(recentA), true);
    assert.equal(await exists(staleB), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
