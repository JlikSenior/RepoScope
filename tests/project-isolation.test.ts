import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  loadActiveSessionCheckpoint,
  persistSessionCheckpoint,
} from "../src/active-session.js";
import {
  assertProjectTargetAllowed,
  isSameProjectPath,
} from "../src/project-scope.js";
import { getProjectStatePaths } from "../src/state.js";
import type { TaskSession } from "../src/types.js";

function makeSession(id: string, targetPath: string): TaskSession {
  return {
    id,
    targetPath,
    task: "isolated task",
    status: "active",
    budgetTokens: 1000,
    usedTokens: 0,
    wholeRepoTokens: 1000,
    deliveredTokens: 0,
    deliveredByTool: {},
    readFiles: {},
    readRanges: {},
    fullyReadFiles: {},
    events: [],
    createdAt: "2026-09-08T00:00:00.000Z",
  };
}

async function doesNotExist(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

test("Windows path comparison is case-insensitive while distinct roots stay distinct", () => {
  assert.equal(
    isSameProjectPath("C:\\Work\\App", "c:\\work\\app", "win32"),
    true,
  );
  assert.equal(
    isSameProjectPath("C:\\Work\\A\\App", "C:\\Work\\B\\App", "win32"),
    false,
  );

  assert.doesNotThrow(() =>
    assertProjectTargetAllowed(
      "c:\\work\\app",
      { REPOSCOPE_BOUND_PROJECT: "C:\\Work\\App" },
      "win32",
    ),
  );
  assert.throws(
    () =>
      assertProjectTargetAllowed(
        "C:\\Work\\other",
        { REPOSCOPE_BOUND_PROJECT: "C:\\Work\\App" },
        "win32",
      ),
    /bound to a different project/,
  );
});

test("bound active checkpoints stay project-local for same-named repositories", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-hard-isolation-"));
  const projectA = join(root, "owner-a", "same-name");
  const projectB = join(root, "owner-b", "same-name");
  const stateRoot = join(root, "state");
  const sessionA = makeSession("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectA);
  const sessionB = makeSession("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", projectB);

  try {
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });

    const optionsA = {
      env: {
        REPOSCOPE_STATE_DIR: stateRoot,
        REPOSCOPE_BOUND_PROJECT: projectA,
      },
    };
    const optionsB = {
      env: {
        REPOSCOPE_STATE_DIR: stateRoot,
        REPOSCOPE_BOUND_PROJECT: projectB,
      },
    };

    await persistSessionCheckpoint(sessionA, optionsA);
    await persistSessionCheckpoint(sessionB, optionsB);

    const pathsA = await getProjectStatePaths(projectA, optionsA);
    const pathsB = await getProjectStatePaths(projectB, optionsB);
    assert.notEqual(pathsA.projectId, pathsB.projectId);
    assert.notEqual(pathsA.activeSessionsDir, pathsB.activeSessionsDir);

    assert.equal(
      (await loadActiveSessionCheckpoint(sessionA.id, optionsA))?.targetPath,
      projectA,
    );
    assert.equal(
      (await loadActiveSessionCheckpoint(sessionB.id, optionsB))?.targetPath,
      projectB,
    );

    assert.equal(
      await loadActiveSessionCheckpoint(sessionA.id, optionsB),
      undefined,
    );
    assert.equal(await doesNotExist(join(stateRoot, "active")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
