import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeSession } from "../src/monitoring";
import type { TaskSession } from "../src/types";

test("search quality measures conversion, coverage, rank, and repeated searches", () => {
  const session: TaskSession = {
    id: "quality-session",
    targetPath: "/tmp/project",
    task: "inspect search quality",
    status: "active",
    budgetTokens: 10000,
    usedTokens: 25,
    wholeRepoTokens: 100000,
    deliveredTokens: 30,
    deliveredByTool: {},
    readFiles: {
      "b.ts": 10,
      "c.ts": 10,
      "direct.ts": 5,
    },
    readRanges: {
      "b.ts": [{ startLine: 1, endLine: 2 }],
      "c.ts": [{ startLine: 1, endLine: 2 }],
      "direct.ts": [{ startLine: 1, endLine: 1 }],
    },
    fullyReadFiles: {},
    events: [
      {
        type: "search",
        timestamp: "2026-09-04T00:00:00.000Z",
        searchTerms: ["Alpha", "Beta"],
        resultFiles: ["a.ts", "b.ts", "c.ts"],
      },
      {
        type: "search",
        timestamp: "2026-09-04T00:00:01.000Z",
        searchTerms: ["beta", "alpha", "alpha"],
        resultFiles: ["b.ts", "d.ts"],
      },
      {
        type: "read",
        timestamp: "2026-09-04T00:00:02.000Z",
        files: ["b.ts"],
        tokens: 10,
      },
      {
        type: "read",
        timestamp: "2026-09-04T00:00:03.000Z",
        files: ["c.ts"],
        tokens: 10,
      },
      {
        type: "read",
        timestamp: "2026-09-04T00:00:04.000Z",
        files: ["direct.ts"],
        tokens: 5,
      },
    ],
    createdAt: "2026-09-04T00:00:00.000Z",
  };

  const quality = summarizeSession(session).searchQuality;

  assert(quality);
  assert.equal(quality.uniqueSearchResults, 4);
  assert.equal(quality.uniqueSearchResultsRead, 2);
  assert.equal(quality.searchResultReadConversionPercent, 50);
  assert.equal(quality.uniqueFilesRead, 3);
  assert.equal(quality.readFilesFoundBySearch, 2);
  assert.equal(quality.readFilesNotFoundBySearch, 1);
  assert.equal(quality.searchCoveragePercent, 66.67);
  assert.equal(quality.averageBestRankOfReadFiles, 2);
  assert.equal(quality.top1ReadHitRatePercent, 33.33);
  assert.equal(quality.top3ReadHitRatePercent, 66.67);
  assert.equal(quality.top5ReadHitRatePercent, 66.67);
  assert.equal(quality.repeatedSearchCount, 1);
  assert.equal(quality.repeatedSearchPercent, 50);
});

test("searches after a file was first read do not get credit for finding it", () => {
  const session: TaskSession = {
    id: "quality-ordering",
    targetPath: "/tmp/project",
    task: "check ordering",
    status: "active",
    budgetTokens: 1000,
    usedTokens: 5,
    wholeRepoTokens: 10000,
    deliveredTokens: 5,
    deliveredByTool: {},
    readFiles: { "known.ts": 5 },
    readRanges: { "known.ts": [{ startLine: 1, endLine: 1 }] },
    fullyReadFiles: {},
    events: [
      {
        type: "read",
        timestamp: "2026-09-04T00:00:00.000Z",
        files: ["known.ts"],
        tokens: 5,
      },
      {
        type: "search",
        timestamp: "2026-09-04T00:00:01.000Z",
        searchTerms: ["known"],
        resultFiles: ["known.ts"],
      },
    ],
    createdAt: "2026-09-04T00:00:00.000Z",
  };

  const quality = summarizeSession(session).searchQuality;

  assert(quality);
  assert.equal(quality.readFilesFoundBySearch, 0);
  assert.equal(quality.readFilesNotFoundBySearch, 1);
  assert.equal(quality.searchCoveragePercent, 0);
  assert.equal(quality.searchResultReadConversionPercent, 0);
});
