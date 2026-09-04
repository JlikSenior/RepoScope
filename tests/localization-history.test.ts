import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildSessionFinishReport } from "../src/monitoring.js";
import {
  buildProjectSessionHistoryReport,
  persistSessionReport,
} from "../src/session-history.js";
import type { TaskSession } from "../src/types.js";

function finishedSession(
  id: string,
  targetPath: string,
  finishedAt: string,
  events: TaskSession["events"],
): TaskSession {
  return {
    id,
    targetPath,
    task: `task ${id}`,
    status: "finished",
    outcome: "success",
    finishedAt,
    budgetTokens: 1000,
    usedTokens: 10,
    wholeRepoTokens: 10000,
    deliveredTokens: 10,
    deliveredByTool: {},
    readFiles: { "sample.ts": 10 },
    readRanges: { "sample.ts": [{ startLine: 1, endLine: 1 }] },
    fullyReadFiles: {},
    events,
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

test("project report excludes legacy sessions from localization quality averages", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-localization-history-project-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-localization-history-state-"));
  const options = { env: { REPOSCOPE_STATE_DIR: stateRoot } };

  try {
    const legacy = finishedSession(
      "legacy",
      project,
      "2026-09-04T00:01:00.000Z",
      [
        {
          type: "search",
          timestamp: "2026-09-04T00:00:10.000Z",
          searchTerms: ["sample"],
          resultFiles: ["sample.ts"],
        },
        {
          type: "read",
          timestamp: "2026-09-04T00:00:20.000Z",
          files: ["sample.ts"],
          tokens: 10,
        },
        {
          type: "finish",
          timestamp: "2026-09-04T00:01:00.000Z",
          outcome: "success",
        },
      ],
    );
    const current = finishedSession(
      "current",
      project,
      "2026-09-04T00:02:00.000Z",
      [
        {
          type: "localization",
          timestamp: "2026-09-04T00:01:10.000Z",
          source: "repo_context",
          searchTerms: ["sample"],
          resultFiles: ["sample.ts"],
        },
        {
          type: "read",
          timestamp: "2026-09-04T00:01:20.000Z",
          files: ["sample.ts"],
          tokens: 10,
        },
        {
          type: "finish",
          timestamp: "2026-09-04T00:02:00.000Z",
          outcome: "success",
        },
      ],
    );

    await persistSessionReport(
      legacy,
      buildSessionFinishReport(legacy),
      options,
    );
    await persistSessionReport(
      current,
      buildSessionFinishReport(current),
      options,
    );

    const report = await buildProjectSessionHistoryReport(project, options);

    assert.equal(report.totalSessions, 2);
    assert.equal(report.averages.localizationQuality.localizationCount, 1);
    assert.equal(report.averages.localizationQuality.repoSearchCount, 0);
    assert.equal(report.averages.localizationQuality.repoContextCount, 1);
    assert.equal(
      report.averages.localizationQuality.localizationCoveragePercent,
      100,
    );
    assert.equal(
      report.recentSessions.find((session) => session.sessionId === "legacy")
        ?.localizationQuality,
      undefined,
    );
    assert.equal(
      report.recentSessions.find((session) => session.sessionId === "current")
        ?.localizationQuality?.localizationCount,
      1,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
