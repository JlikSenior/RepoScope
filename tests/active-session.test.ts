import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  loadActiveSessionCheckpoint,
  persistSessionCheckpoint,
  removeSessionCheckpoint,
} from "../src/active-session";
import { ensureProjectState } from "../src/state";
import type { TaskSession } from "../src/types";

function makeSession(id: string, targetPath: string): TaskSession {
  return {
    id,
    targetPath,
    task: "recover active task",
    status: "active",
    budgetTokens: 1000,
    usedTokens: 120,
    wholeRepoTokens: 10000,
    deliveredTokens: 150,
    deliveredByTool: { repo_read: 150 },
    readFiles: { "src/example.ts": 120 },
    readRanges: { "src/example.ts": [{ startLine: 10, endLine: 30 }] },
    fullyReadFiles: {},
    events: [
      {
        type: "search",
        timestamp: "2026-09-04T00:00:00.000Z",
        searchTerms: ["example"],
        resultFiles: ["src/example.ts"],
      },
    ],
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

test("active session checkpoints round-trip outside the repository", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-active-project-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-active-state-"));
  const options = { env: { REPOSCOPE_STATE_DIR: stateRoot } };
  const session = makeSession("11111111-1111-4111-8111-111111111111", project);

  try {
    const snapshotPath = await persistSessionCheckpoint(session, options);
    assert(snapshotPath.startsWith(stateRoot));
    assert(!snapshotPath.startsWith(project));

    const restored = await loadActiveSessionCheckpoint(session.id, options);
    assert(restored);
    assert.equal(restored.id, session.id);
    assert.equal(restored.usedTokens, 120);
    assert.deepEqual(restored.readRanges, session.readRanges);
    assert.deepEqual(restored.events, session.events);

    const paths = await ensureProjectState(project, options);
    const locator = JSON.parse(
      await readFile(join(paths.activeIndexDir, `${session.id}.json`), "utf8"),
    ) as { projectId: string };
    assert.equal(locator.projectId, paths.projectId);

    await removeSessionCheckpoint(session, options);
    assert.equal(await loadActiveSessionCheckpoint(session.id, options), undefined);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("finished reports prevent stale active checkpoints from being restored", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-stale-project-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-stale-state-"));
  const options = { env: { REPOSCOPE_STATE_DIR: stateRoot } };
  const session = makeSession("22222222-2222-4222-8222-222222222222", project);

  try {
    await persistSessionCheckpoint(session, options);
    const paths = await ensureProjectState(project, options);
    await writeFile(
      join(paths.sessionsDir, `${session.id}.json`),
      '{"schemaVersion":1}\n',
      "utf8",
    );

    assert.equal(await loadActiveSessionCheckpoint(session.id, options), undefined);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("non-active checkpoints are never restored", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-finished-project-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-finished-state-"));
  const options = { env: { REPOSCOPE_STATE_DIR: stateRoot } };
  const session = makeSession("33333333-3333-4333-8333-333333333333", project);
  session.status = "finished";
  session.outcome = "success";
  session.finishedAt = "2026-09-04T00:01:00.000Z";

  try {
    await persistSessionCheckpoint(session, options);
    assert.equal(await loadActiveSessionCheckpoint(session.id, options), undefined);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
