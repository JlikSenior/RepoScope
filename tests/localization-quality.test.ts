import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeLocalizationQuality } from "../src/localization-quality.js";
import type { TaskSession } from "../src/types.js";

function makeSession(events: TaskSession["events"]): TaskSession {
  return {
    id: "localization-test",
    targetPath: "/tmp/localization-test",
    task: "measure localization",
    status: "active",
    budgetTokens: 1000,
    usedTokens: 0,
    wholeRepoTokens: 10000,
    deliveredTokens: 0,
    deliveredByTool: {},
    readFiles: {},
    readRanges: {},
    fullyReadFiles: {},
    events,
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

test("localization quality combines repo_search and repo_context before first read", () => {
  const metrics = summarizeLocalizationQuality(
    makeSession([
      {
        type: "localization",
        timestamp: "2026-09-04T00:00:01.000Z",
        source: "repo_search",
        searchTerms: ["alpha"],
        resultFiles: ["alpha.ts", "other.ts"],
      },
      {
        type: "read",
        timestamp: "2026-09-04T00:00:02.000Z",
        files: ["alpha.ts"],
        tokens: 10,
      },
      {
        type: "localization",
        timestamp: "2026-09-04T00:00:03.000Z",
        source: "repo_context",
        searchTerms: ["beta"],
        resultFiles: ["beta.ts", "other.ts"],
      },
      {
        type: "read",
        timestamp: "2026-09-04T00:00:04.000Z",
        files: ["beta.ts"],
        tokens: 10,
      },
    ]),
  );

  assert(metrics);
  assert.equal(metrics.localizationCount, 2);
  assert.equal(metrics.repoSearchCount, 1);
  assert.equal(metrics.repoContextCount, 1);
  assert.equal(metrics.uniqueLocalizationResults, 3);
  assert.equal(metrics.uniqueLocalizationResultsRead, 2);
  assert.equal(metrics.localizationResultReadConversionPercent, 66.67);
  assert.equal(metrics.localizationCoveragePercent, 100);
  assert.equal(metrics.averageBestRankOfReadFiles, 1);
  assert.equal(metrics.top1ReadHitRatePercent, 100);
});

test("localization after first read does not receive retroactive credit", () => {
  const metrics = summarizeLocalizationQuality(
    makeSession([
      {
        type: "read",
        timestamp: "2026-09-04T00:00:01.000Z",
        files: ["late.ts"],
        tokens: 10,
      },
      {
        type: "localization",
        timestamp: "2026-09-04T00:00:02.000Z",
        source: "repo_context",
        searchTerms: ["late"],
        resultFiles: ["late.ts"],
      },
    ]),
  );

  assert(metrics);
  assert.equal(metrics.readFilesFoundByLocalization, 0);
  assert.equal(metrics.readFilesNotFoundByLocalization, 1);
  assert.equal(metrics.localizationCoveragePercent, 0);
});

test("repeated localization is detected across tool sources", () => {
  const metrics = summarizeLocalizationQuality(
    makeSession([
      {
        type: "localization",
        timestamp: "2026-09-04T00:00:01.000Z",
        source: "repo_search",
        searchTerms: ["Alpha", " beta "],
        resultFiles: [],
      },
      {
        type: "localization",
        timestamp: "2026-09-04T00:00:02.000Z",
        source: "repo_context",
        searchTerms: ["beta", "alpha", "alpha"],
        resultFiles: [],
      },
    ]),
  );

  assert(metrics);
  assert.equal(metrics.repeatedLocalizationCount, 1);
  assert.equal(metrics.repeatedLocalizationPercent, 50);
});

test("sessions without localization events have no localization quality metric", () => {
  assert.equal(summarizeLocalizationQuality(makeSession([])), undefined);
});
