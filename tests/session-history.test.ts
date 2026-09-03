import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildProjectSessionHistoryReport,
  persistSessionReport,
  readProjectSessionHistory,
} from "../src/session-history.js";
import type { SessionFinishReport, TaskSession } from "../src/types.js";

function makeSession(id: string, targetPath: string): TaskSession {
  return {
    id,
    targetPath,
    task: `task ${id}`,
    status: "finished",
    outcome: "success",
    finishedAt: "2026-09-03T00:00:00.000Z",
    budgetTokens: 1000,
    usedTokens: 0,
    wholeRepoTokens: 10000,
    deliveredTokens: 0,
    deliveredByTool: {},
    readFiles: {},
    readRanges: {},
    fullyReadFiles: {},
    events: [],
    createdAt: "2026-09-02T23:59:00.000Z",
  };
}

function makeReport(
  sessionId: string,
  overrides: Partial<SessionFinishReport> = {},
): SessionFinishReport {
  return {
    sessionId,
    task: `task ${sessionId}`,
    outcome: "success",
    finishedAt: `2026-09-03T00:0${sessionId === "a" ? "1" : "2"}:00.000Z`,
    verification: { status: "not_run" },
    changedFiles: [],
    metrics: {
      sessionId,
      status: "finished",
      outcome: "success",
      finishedAt: "2026-09-03T00:00:00.000Z",
      budgetTokens: 1000,
      usedTokens: sessionId === "a" ? 100 : 300,
      remainingTokens: sessionId === "a" ? 900 : 700,
      wholeRepoTokens: 10000,
      deliveredTokens: sessionId === "a" ? 120 : 360,
      toolOverheadTokens: sessionId === "a" ? 20 : 60,
      toolOverheadPercent: 16.67,
      sourceReductionPercent: sessionId === "a" ? 99 : 97,
      netContextReductionPercent: sessionId === "a" ? 98.8 : 96.4,
      searchCount: sessionId === "a" ? 2 : 4,
      readCount: sessionId === "a" ? 3 : 7,
      writeCount: 0,
      runCount: 0,
      failedRunCount: 0,
      blockedReadCount: 0,
      blockedContextCount: 0,
      uniqueFilesRead: sessionId === "a" ? 3 : 6,
      sourceLinesRead: sessionId === "a" ? 120 : 280,
      utilizationPercent: sessionId === "a" ? 10 : 30,
    },
    ...overrides,
  };
}

test("finished session reports persist per project and aggregate into a trend report", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-history-project-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "reposcope-history-state-"));
  const options = { env: { REPOSCOPE_STATE_DIR: stateRoot } };

  try {
    const sessionA = makeSession("a", project);
    const sessionB = makeSession("b", project);
    const reportA = makeReport("a");
    const reportB = makeReport("b", {
      outcome: "failed",
      verification: { status: "failed" },
      metrics: {
        ...makeReport("b").metrics,
        outcome: "failed",
        searchQuality: {
          uniqueSearchResults: 10,
          uniqueSearchResultsRead: 4,
          searchResultReadConversionPercent: 40,
          uniqueFilesRead: 5,
          readFilesFoundBySearch: 4,
          readFilesNotFoundBySearch: 1,
          searchCoveragePercent: 80,
          averageBestRankOfReadFiles: 2.5,
          top1ReadHitRatePercent: 20,
          top3ReadHitRatePercent: 60,
          top5ReadHitRatePercent: 80,
          repeatedSearchCount: 1,
          repeatedSearchPercent: 25,
        },
      },
    });

    const pathA = await persistSessionReport(sessionA, reportA, options);
    const pathB = await persistSessionReport(sessionB, reportB, options);

    assert.notEqual(pathA, pathB);
    assert.match(await readFile(pathA, "utf8"), /"sessionId": "a"/);

    const history = await readProjectSessionHistory(project, options);
    assert.deepEqual(
      history.map((record) => record.report.sessionId),
      ["a", "b"],
    );

    const summary = await buildProjectSessionHistoryReport(project, options);
    assert.equal(summary.totalSessions, 2);
    assert.deepEqual(summary.outcomes, {
      success: 1,
      failed: 1,
      abandoned: 0,
    });
    assert.deepEqual(summary.verification, {
      passed: 0,
      failed: 1,
      not_run: 1,
    });
    assert.equal(summary.averages.usedTokens, 200);
    assert.equal(summary.averages.uniqueFilesRead, 4.5);
    assert.equal(summary.averages.sourceLinesRead, 200);
    assert.equal(summary.averages.sourceReductionPercent, 98);
    assert.equal(
      summary.averages.searchQuality.searchResultReadConversionPercent,
      40,
    );
    assert.equal(summary.averages.searchQuality.searchCoveragePercent, 80);
    assert.equal(
      summary.averages.searchQuality.averageBestRankOfReadFiles,
      2.5,
    );
    assert.deepEqual(
      summary.recentSessions.map((session) => session.sessionId),
      ["b", "a"],
    );
    assert.equal(
      summary.recentSessions[0].searchQuality?.repeatedSearchPercent,
      25,
    );
    assert.equal(summary.recentSessions[1].searchQuality, undefined);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
