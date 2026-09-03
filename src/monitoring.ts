import { appendFile, readFile } from "node:fs/promises";

import type {
  LatencyTool,
  MonitoringEvent,
  MonitoringSummary,
  SearchQualityMetrics,
  SessionFinishReport,
  SessionLatencyMetrics,
  SessionMetrics,
  SessionVerificationStatus,
  TaskSession,
  ToolLatencyAggregate,
} from "./types";

export async function readMonitoringEvents(
  logPath: string,
): Promise<MonitoringEvent[]> {
  const content = await readFile(logPath, "utf8");

  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MonitoringEvent);
}

export async function appendMonitoringEvent(
  logPath: string,
  event: MonitoringEvent,
): Promise<void> {
  await appendFile(logPath, JSON.stringify(event) + "\n");
}

export function summarizeMonitoring(
  events: MonitoringEvent[],
): MonitoringSummary {
  const wholeRepoBaselineTokens = events.reduce(
    (sum, event) => sum + event.repoTokens,
    0,
  );
  const selectedContextTokens = events.reduce(
    (sum, event) => sum + event.selectedTokens,
    0,
  );
  const savedTokens = events.reduce(
    (sum, event) => sum + event.savedTokens,
    0,
  );
  const reductionPercent =
    wholeRepoBaselineTokens === 0
      ? 0
      : (savedTokens / wholeRepoBaselineTokens) * 100;

  return {
    totalTasks: events.length,
    wholeRepoBaselineTokens,
    selectedContextTokens,
    savedTokens,
    reductionPercent: Number(reductionPercent.toFixed(2)),
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function aggregateLatency(values: Array<{ durationMs: number; failed: boolean }>): ToolLatencyAggregate {
  const totalMs = values.reduce((sum, value) => sum + value.durationMs, 0);

  return {
    count: values.length,
    failedCount: values.filter((value) => value.failed).length,
    totalMs: round(totalMs),
    averageMs: values.length === 0 ? 0 : round(totalMs / values.length),
    maxMs: values.length === 0 ? 0 : round(Math.max(...values.map((value) => value.durationMs))),
  };
}

function summarizeLatency(session: TaskSession): SessionLatencyMetrics | undefined {
  const events = session.events.filter(
    (event): event is Extract<TaskSession["events"][number], { type: "latency" }> =>
      event.type === "latency",
  );

  if (events.length === 0) return undefined;

  const byTool = (tool: LatencyTool) =>
    events
      .filter((event) => event.tool === tool)
      .map((event) => ({ durationMs: event.durationMs, failed: event.failed }));
  const scanCalls = events.reduce((sum, event) => sum + event.scan.calls, 0);
  const scanCacheHits = events.reduce((sum, event) => sum + event.scan.cacheHits, 0);
  const scanCacheMisses = events.reduce((sum, event) => sum + event.scan.cacheMisses, 0);
  const scanInFlightHits = events.reduce((sum, event) => sum + event.scan.inFlightHits, 0);
  const scanTotalMs = events.reduce((sum, event) => sum + event.scan.totalMs, 0);
  const scanMaxMs = events.reduce((max, event) => Math.max(max, event.scan.maxMs), 0);
  const searchRgRuns = events.reduce((sum, event) => sum + event.searchRg.runs, 0);
  const searchRgTotalMs = events.reduce((sum, event) => sum + event.searchRg.totalMs, 0);
  const searchRgMaxMs = events.reduce((max, event) => Math.max(max, event.searchRg.maxMs), 0);

  return {
    repoSessionStart: aggregateLatency(byTool("repo_session_start")),
    repoSearch: aggregateLatency(byTool("repo_search")),
    repoRead: aggregateLatency(byTool("repo_read")),
    repoContext: aggregateLatency(byTool("repo_context")),
    scan: {
      calls: scanCalls,
      cacheHits: scanCacheHits,
      cacheMisses: scanCacheMisses,
      inFlightHits: scanInFlightHits,
      cacheHitPercent: scanCalls === 0 ? 0 : round((scanCacheHits / scanCalls) * 100),
      totalMs: round(scanTotalMs),
      averageMs: scanCalls === 0 ? 0 : round(scanTotalMs / scanCalls),
      maxMs: round(scanMaxMs),
    },
    searchRg: {
      runs: searchRgRuns,
      totalMs: round(searchRgTotalMs),
      averageRunMs: searchRgRuns === 0 ? 0 : round(searchRgTotalMs / searchRgRuns),
      maxMs: round(searchRgMaxMs),
    },
  };
}

function canonicalSearchKey(searchTerms: string[]): string {
  return [...new Set(
    searchTerms
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean),
  )]
    .sort()
    .join("\u0000");
}

function summarizeSearchQuality(session: TaskSession): SearchQualityMetrics {
  const uniqueSearchResults = new Set<string>();
  const uniqueReadFiles = new Set<string>();
  const bestSearchRankSeen = new Map<string, number>();
  const firstReadBestRanks = new Map<string, number>();
  const seenSearchKeys = new Set<string>();
  let searchCount = 0;
  let repeatedSearchCount = 0;

  for (const event of session.events) {
    if (event.type === "search") {
      searchCount += 1;
      const searchKey = canonicalSearchKey(event.searchTerms);

      if (searchKey) {
        if (seenSearchKeys.has(searchKey)) {
          repeatedSearchCount += 1;
        } else {
          seenSearchKeys.add(searchKey);
        }
      }

      event.resultFiles.forEach((path, index) => {
        uniqueSearchResults.add(path);
        const rank = index + 1;
        const previousRank = bestSearchRankSeen.get(path);

        if (previousRank === undefined || rank < previousRank) {
          bestSearchRankSeen.set(path, rank);
        }
      });
      continue;
    }

    if (event.type !== "read") continue;

    for (const file of event.files) {
      if (uniqueReadFiles.has(file)) continue;

      uniqueReadFiles.add(file);
      const rank = bestSearchRankSeen.get(file);
      if (rank !== undefined) {
        firstReadBestRanks.set(file, rank);
      }
    }
  }

  const readRanks = [...firstReadBestRanks.values()];
  const readFilesFoundBySearch = firstReadBestRanks.size;
  const readFilesNotFoundBySearch = Math.max(
    uniqueReadFiles.size - readFilesFoundBySearch,
    0,
  );
  const readDenominator = uniqueReadFiles.size;
  const searchedDenominator = uniqueSearchResults.size;
  const averageBestRankOfReadFiles =
    readRanks.length === 0
      ? 0
      : round(readRanks.reduce((sum, rank) => sum + rank, 0) / readRanks.length);
  const hitRate = (limit: number) =>
    readDenominator === 0
      ? 0
      : round((readRanks.filter((rank) => rank <= limit).length / readDenominator) * 100);

  return {
    uniqueSearchResults: uniqueSearchResults.size,
    uniqueSearchResultsRead: readFilesFoundBySearch,
    searchResultReadConversionPercent:
      searchedDenominator === 0
        ? 0
        : round((readFilesFoundBySearch / searchedDenominator) * 100),
    uniqueFilesRead: uniqueReadFiles.size,
    readFilesFoundBySearch,
    readFilesNotFoundBySearch,
    searchCoveragePercent:
      readDenominator === 0
        ? 0
        : round((readFilesFoundBySearch / readDenominator) * 100),
    averageBestRankOfReadFiles,
    top1ReadHitRatePercent: hitRate(1),
    top3ReadHitRatePercent: hitRate(3),
    top5ReadHitRatePercent: hitRate(5),
    repeatedSearchCount,
    repeatedSearchPercent:
      searchCount === 0 ? 0 : round((repeatedSearchCount / searchCount) * 100),
  };
}

export function summarizeSession(session: TaskSession): SessionMetrics {
  let searchCount = 0;
  let readCount = 0;
  let writeCount = 0;
  let runCount = 0;
  let failedRunCount = 0;
  let blockedReadCount = 0;
  let blockedContextCount = 0;

  for (const event of session.events) {
    if (event.type === "search") searchCount += 1;
    if (event.type === "read") readCount += 1;
    if (event.type === "write") writeCount += 1;

    if (event.type === "run") {
      runCount += 1;
      if (event.timedOut || event.exitCode !== 0) failedRunCount += 1;
    }

    if (event.type === "blocked" && event.action === "read") {
      blockedReadCount += 1;
    }

    if (event.type === "blocked" && event.action === "context") {
      blockedContextCount += 1;
    }
  }

  const remainingTokens = session.budgetTokens - session.usedTokens;
  const utilizationPercent =
    session.budgetTokens === 0
      ? 0
      : (session.usedTokens / session.budgetTokens) * 100;
  const sourceReductionPercent =
    session.wholeRepoTokens === 0
      ? 0
      : ((session.wholeRepoTokens - session.usedTokens) /
          session.wholeRepoTokens) *
        100;
  const toolOverheadTokens = Math.max(
    session.deliveredTokens - session.usedTokens,
    0,
  );
  const toolOverheadPercent =
    session.deliveredTokens === 0
      ? 0
      : (toolOverheadTokens / session.deliveredTokens) * 100;
  const netContextReductionPercent =
    session.wholeRepoTokens === 0
      ? 0
      : ((session.wholeRepoTokens - session.deliveredTokens) /
          session.wholeRepoTokens) *
        100;
  const sourceLinesRead = Object.values(session.readRanges).reduce(
    (sum, ranges) =>
      sum +
      ranges.reduce(
        (rangeSum, range) => rangeSum + range.endLine - range.startLine + 1,
        0,
      ),
    0,
  );

  return {
    sessionId: session.id,
    status: session.status,
    outcome: session.outcome,
    finishedAt: session.finishedAt,
    budgetTokens: session.budgetTokens,
    usedTokens: session.usedTokens,
    deliveredTokens: session.deliveredTokens,
    remainingTokens,
    wholeRepoTokens: session.wholeRepoTokens,
    sourceReductionPercent: Number(sourceReductionPercent.toFixed(2)),
    netContextReductionPercent: Number(netContextReductionPercent.toFixed(2)),
    searchCount,
    readCount,
    writeCount,
    runCount,
    failedRunCount,
    blockedReadCount,
    blockedContextCount,
    uniqueFilesRead: Object.keys(session.readFiles).length,
    sourceLinesRead,
    utilizationPercent: Number(utilizationPercent.toFixed(2)),
    toolOverheadTokens,
    toolOverheadPercent: Number(toolOverheadPercent.toFixed(2)),
    latency: summarizeLatency(session),
    searchQuality: summarizeSearchQuality(session),
  };
}

export function buildSessionFinishReport(
  session: TaskSession,
): SessionFinishReport {
  if (
    session.status !== "finished" ||
    !session.outcome ||
    !session.finishedAt
  ) {
    throw new Error("Session is not finished");
  }

  const changedFiles = new Set<string>();
  let lastRun:
    | Extract<TaskSession["events"][number], { type: "run" }>
    | undefined;

  for (const event of session.events) {
    if (event.type === "write") {
      for (const file of event.files) changedFiles.add(file);
    }

    if (event.type === "run") lastRun = event;
  }

  let verificationStatus: SessionVerificationStatus = "not_run";

  if (lastRun) {
    verificationStatus =
      !lastRun.timedOut && lastRun.exitCode === 0 ? "passed" : "failed";
  }

  return {
    sessionId: session.id,
    task: session.task,
    outcome: session.outcome,
    note: session.note,
    finishedAt: session.finishedAt,
    verification: {
      status: verificationStatus,
      command: lastRun?.command,
      exitCode: lastRun?.exitCode,
      timedOut: lastRun?.timedOut,
    },
    changedFiles: [...changedFiles].sort(),
    metrics: summarizeSession(session),
  };
}
