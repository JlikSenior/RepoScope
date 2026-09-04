import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureProjectState,
  getProjectStatePaths,
  type StatePathOptions,
} from "./state.js";
import type { SessionFinishReport, TaskSession } from "./types.js";

export type PersistedSessionRecord = {
  schemaVersion: 1;
  projectId: string;
  targetPath: string;
  createdAt: string;
  report: SessionFinishReport;
};

export type ProjectSessionHistoryReport = {
  schemaVersion: 1;
  projectId: string;
  targetPath: string;
  stateDirectory: string;
  totalSessions: number;
  outcomes: {
    success: number;
    failed: number;
    abandoned: number;
  };
  verification: {
    passed: number;
    failed: number;
    not_run: number;
  };
  averages: {
    usedTokens: number;
    deliveredTokens: number;
    uniqueFilesRead: number;
    sourceLinesRead: number;
    searchCount: number;
    readCount: number;
    sourceReductionPercent: number;
    netContextReductionPercent: number;
    utilizationPercent: number;
    toolOverheadPercent: number;
    latency: {
      repoSessionStartMs: number;
      repoSearchMs: number;
      repoReadMs: number;
      repoContextMs: number;
      scanCacheHitPercent: number;
      scanAverageMs: number;
      searchRgAverageRunMs: number;
    };
    searchQuality: {
      uniqueSearchResults: number;
      readFilesFoundBySearch: number;
      readFilesNotFoundBySearch: number;
      searchResultReadConversionPercent: number;
      searchCoveragePercent: number;
      averageBestRankOfReadFiles: number;
      top1ReadHitRatePercent: number;
      top3ReadHitRatePercent: number;
      top5ReadHitRatePercent: number;
      repeatedSearchPercent: number;
    };
    localizationQuality: {
      localizationCount: number;
      repoSearchCount: number;
      repoContextCount: number;
      uniqueLocalizationResults: number;
      readFilesFoundByLocalization: number;
      readFilesNotFoundByLocalization: number;
      localizationResultReadConversionPercent: number;
      localizationCoveragePercent: number;
      averageBestRankOfReadFiles: number;
      top1ReadHitRatePercent: number;
      top3ReadHitRatePercent: number;
      top5ReadHitRatePercent: number;
      repeatedLocalizationPercent: number;
    };
  };
  recentSessions: Array<{
    sessionId: string;
    task: string;
    outcome: SessionFinishReport["outcome"];
    verification: SessionFinishReport["verification"]["status"];
    finishedAt: string;
    usedTokens: number;
    deliveredTokens: number;
    uniqueFilesRead: number;
    sourceLinesRead: number;
    searchCount: number;
    readCount: number;
    sourceReductionPercent: number;
    netContextReductionPercent: number;
    latency?: {
      repoSessionStartMs: number;
      repoSearchMs: number;
      repoReadMs: number;
      repoContextMs: number;
      scanCacheHitPercent: number;
      searchRgAverageRunMs: number;
    };
    searchQuality?: {
      uniqueSearchResults: number;
      uniqueSearchResultsRead: number;
      searchResultReadConversionPercent: number;
      searchCoveragePercent: number;
      averageBestRankOfReadFiles: number;
      top1ReadHitRatePercent: number;
      top3ReadHitRatePercent: number;
      top5ReadHitRatePercent: number;
      repeatedSearchCount: number;
      repeatedSearchPercent: number;
    };
    localizationQuality?: {
      localizationCount: number;
      repoSearchCount: number;
      repoContextCount: number;
      uniqueLocalizationResults: number;
      uniqueLocalizationResultsRead: number;
      localizationResultReadConversionPercent: number;
      localizationCoveragePercent: number;
      averageBestRankOfReadFiles: number;
      top1ReadHitRatePercent: number;
      top3ReadHitRatePercent: number;
      top5ReadHitRatePercent: number;
      repeatedLocalizationCount: number;
      repeatedLocalizationPercent: number;
    };
  }>;
};

type NumericSessionMetricKey =
  | "usedTokens"
  | "deliveredTokens"
  | "uniqueFilesRead"
  | "sourceLinesRead"
  | "searchCount"
  | "readCount"
  | "sourceReductionPercent"
  | "netContextReductionPercent"
  | "utilizationPercent"
  | "toolOverheadPercent";

function round(value: number): number {
  return Number(value.toFixed(2));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function metricValues(
  reports: SessionFinishReport[],
  key: NumericSessionMetricKey,
): number[] {
  return reports.map((report) => report.metrics[key]);
}

function latencyValues(
  reports: SessionFinishReport[],
  select: (report: SessionFinishReport) => number,
): number[] {
  return reports
    .filter((report) => report.metrics.latency !== undefined)
    .map(select);
}

function searchQualityValues(
  reports: SessionFinishReport[],
  select: (report: SessionFinishReport) => number,
  include: (report: SessionFinishReport) => boolean = () => true,
): number[] {
  return reports
    .filter(
      (report) =>
        report.metrics.searchQuality !== undefined && include(report),
    )
    .map(select);
}

function localizationQualityValues(
  reports: SessionFinishReport[],
  select: (report: SessionFinishReport) => number,
  include: (report: SessionFinishReport) => boolean = () => true,
): number[] {
  return reports
    .filter(
      (report) =>
        report.metrics.localizationQuality !== undefined && include(report),
    )
    .map(select);
}

export async function persistSessionReport(
  session: TaskSession,
  report: SessionFinishReport,
  options: StatePathOptions = {},
): Promise<string> {
  const paths = await ensureProjectState(session.targetPath, options);
  const record: PersistedSessionRecord = {
    schemaVersion: 1,
    projectId: paths.projectId,
    targetPath: session.targetPath,
    createdAt: session.createdAt,
    report,
  };
  const path = join(paths.sessionsDir, `${session.id}.json`);

  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return path;
}

export async function readProjectSessionHistory(
  targetPath: string,
  options: StatePathOptions = {},
): Promise<PersistedSessionRecord[]> {
  const paths = await ensureProjectState(targetPath, options);
  const entries = await readdir(paths.sessionsDir, { withFileTypes: true });
  const records: PersistedSessionRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const raw = await readFile(join(paths.sessionsDir, entry.name), "utf8");
    const record = JSON.parse(raw) as PersistedSessionRecord;

    if (
      record.schemaVersion !== 1 ||
      record.projectId !== paths.projectId ||
      !record.report?.sessionId
    ) {
      continue;
    }

    records.push(record);
  }

  return records.sort((a, b) =>
    a.report.finishedAt.localeCompare(b.report.finishedAt),
  );
}

export async function buildProjectSessionHistoryReport(
  targetPath: string,
  options: StatePathOptions = {},
): Promise<ProjectSessionHistoryReport> {
  const paths = await getProjectStatePaths(targetPath, options);
  const records = await readProjectSessionHistory(targetPath, options);
  const reports = records.map((record) => record.report);

  const outcomes = { success: 0, failed: 0, abandoned: 0 };
  const verification = { passed: 0, failed: 0, not_run: 0 };

  for (const report of reports) {
    outcomes[report.outcome] += 1;
    verification[report.verification.status] += 1;
  }

  return {
    schemaVersion: 1,
    projectId: paths.projectId,
    targetPath,
    stateDirectory: paths.projectDir,
    totalSessions: reports.length,
    outcomes,
    verification,
    averages: {
      usedTokens: average(metricValues(reports, "usedTokens")),
      deliveredTokens: average(metricValues(reports, "deliveredTokens")),
      uniqueFilesRead: average(metricValues(reports, "uniqueFilesRead")),
      sourceLinesRead: average(metricValues(reports, "sourceLinesRead")),
      searchCount: average(metricValues(reports, "searchCount")),
      readCount: average(metricValues(reports, "readCount")),
      sourceReductionPercent: average(
        metricValues(reports, "sourceReductionPercent"),
      ),
      netContextReductionPercent: average(
        metricValues(reports, "netContextReductionPercent"),
      ),
      utilizationPercent: average(metricValues(reports, "utilizationPercent")),
      toolOverheadPercent: average(metricValues(reports, "toolOverheadPercent")),
      latency: {
        repoSessionStartMs: average(
          latencyValues(
            reports,
            (report) => report.metrics.latency!.repoSessionStart.averageMs,
          ),
        ),
        repoSearchMs: average(
          latencyValues(
            reports,
            (report) => report.metrics.latency!.repoSearch.averageMs,
          ),
        ),
        repoReadMs: average(
          latencyValues(
            reports,
            (report) => report.metrics.latency!.repoRead.averageMs,
          ),
        ),
        repoContextMs: average(
          latencyValues(
            reports,
            (report) => report.metrics.latency!.repoContext.averageMs,
          ),
        ),
        scanCacheHitPercent: average(
          latencyValues(
            reports,
            (report) => report.metrics.latency!.scan.cacheHitPercent,
          ),
        ),
        scanAverageMs: average(
          latencyValues(
            reports,
            (report) => report.metrics.latency!.scan.averageMs,
          ),
        ),
        searchRgAverageRunMs: average(
          latencyValues(
            reports,
            (report) => report.metrics.latency!.searchRg.averageRunMs,
          ),
        ),
      },
      searchQuality: {
        uniqueSearchResults: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.uniqueSearchResults,
          ),
        ),
        readFilesFoundBySearch: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.readFilesFoundBySearch,
          ),
        ),
        readFilesNotFoundBySearch: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.readFilesNotFoundBySearch,
          ),
        ),
        searchResultReadConversionPercent: average(
          searchQualityValues(
            reports,
            (report) =>
              report.metrics.searchQuality!.searchResultReadConversionPercent,
          ),
        ),
        searchCoveragePercent: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.searchCoveragePercent,
          ),
        ),
        averageBestRankOfReadFiles: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.averageBestRankOfReadFiles,
            (report) =>
              (report.metrics.searchQuality?.readFilesFoundBySearch ?? 0) > 0,
          ),
        ),
        top1ReadHitRatePercent: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.top1ReadHitRatePercent,
          ),
        ),
        top3ReadHitRatePercent: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.top3ReadHitRatePercent,
          ),
        ),
        top5ReadHitRatePercent: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.top5ReadHitRatePercent,
          ),
        ),
        repeatedSearchPercent: average(
          searchQualityValues(
            reports,
            (report) => report.metrics.searchQuality!.repeatedSearchPercent,
          ),
        ),
      },
      localizationQuality: {
        localizationCount: average(
          localizationQualityValues(
            reports,
            (report) => report.metrics.localizationQuality!.localizationCount,
          ),
        ),
        repoSearchCount: average(
          localizationQualityValues(
            reports,
            (report) => report.metrics.localizationQuality!.repoSearchCount,
          ),
        ),
        repoContextCount: average(
          localizationQualityValues(
            reports,
            (report) => report.metrics.localizationQuality!.repoContextCount,
          ),
        ),
        uniqueLocalizationResults: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.uniqueLocalizationResults,
          ),
        ),
        readFilesFoundByLocalization: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.readFilesFoundByLocalization,
          ),
        ),
        readFilesNotFoundByLocalization: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.readFilesNotFoundByLocalization,
          ),
        ),
        localizationResultReadConversionPercent: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!
                .localizationResultReadConversionPercent,
          ),
        ),
        localizationCoveragePercent: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.localizationCoveragePercent,
          ),
        ),
        averageBestRankOfReadFiles: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.averageBestRankOfReadFiles,
            (report) =>
              (report.metrics.localizationQuality?.readFilesFoundByLocalization ??
                0) > 0,
          ),
        ),
        top1ReadHitRatePercent: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.top1ReadHitRatePercent,
          ),
        ),
        top3ReadHitRatePercent: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.top3ReadHitRatePercent,
          ),
        ),
        top5ReadHitRatePercent: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.top5ReadHitRatePercent,
          ),
        ),
        repeatedLocalizationPercent: average(
          localizationQualityValues(
            reports,
            (report) =>
              report.metrics.localizationQuality!.repeatedLocalizationPercent,
          ),
        ),
      },
    },
    recentSessions: reports
      .slice(-10)
      .reverse()
      .map((report) => ({
        sessionId: report.sessionId,
        task: report.task,
        outcome: report.outcome,
        verification: report.verification.status,
        finishedAt: report.finishedAt,
        usedTokens: report.metrics.usedTokens,
        deliveredTokens: report.metrics.deliveredTokens,
        uniqueFilesRead: report.metrics.uniqueFilesRead,
        sourceLinesRead: report.metrics.sourceLinesRead,
        searchCount: report.metrics.searchCount,
        readCount: report.metrics.readCount,
        sourceReductionPercent: report.metrics.sourceReductionPercent,
        netContextReductionPercent: report.metrics.netContextReductionPercent,
        latency: report.metrics.latency
          ? {
              repoSessionStartMs:
                report.metrics.latency.repoSessionStart.averageMs,
              repoSearchMs: report.metrics.latency.repoSearch.averageMs,
              repoReadMs: report.metrics.latency.repoRead.averageMs,
              repoContextMs: report.metrics.latency.repoContext.averageMs,
              scanCacheHitPercent:
                report.metrics.latency.scan.cacheHitPercent,
              searchRgAverageRunMs:
                report.metrics.latency.searchRg.averageRunMs,
            }
          : undefined,
        searchQuality: report.metrics.searchQuality
          ? {
              uniqueSearchResults:
                report.metrics.searchQuality.uniqueSearchResults,
              uniqueSearchResultsRead:
                report.metrics.searchQuality.uniqueSearchResultsRead,
              searchResultReadConversionPercent:
                report.metrics.searchQuality.searchResultReadConversionPercent,
              searchCoveragePercent:
                report.metrics.searchQuality.searchCoveragePercent,
              averageBestRankOfReadFiles:
                report.metrics.searchQuality.averageBestRankOfReadFiles,
              top1ReadHitRatePercent:
                report.metrics.searchQuality.top1ReadHitRatePercent,
              top3ReadHitRatePercent:
                report.metrics.searchQuality.top3ReadHitRatePercent,
              top5ReadHitRatePercent:
                report.metrics.searchQuality.top5ReadHitRatePercent,
              repeatedSearchCount:
                report.metrics.searchQuality.repeatedSearchCount,
              repeatedSearchPercent:
                report.metrics.searchQuality.repeatedSearchPercent,
            }
          : undefined,
        localizationQuality: report.metrics.localizationQuality
          ? {
              localizationCount:
                report.metrics.localizationQuality.localizationCount,
              repoSearchCount:
                report.metrics.localizationQuality.repoSearchCount,
              repoContextCount:
                report.metrics.localizationQuality.repoContextCount,
              uniqueLocalizationResults:
                report.metrics.localizationQuality.uniqueLocalizationResults,
              uniqueLocalizationResultsRead:
                report.metrics.localizationQuality.uniqueLocalizationResultsRead,
              localizationResultReadConversionPercent:
                report.metrics.localizationQuality
                  .localizationResultReadConversionPercent,
              localizationCoveragePercent:
                report.metrics.localizationQuality.localizationCoveragePercent,
              averageBestRankOfReadFiles:
                report.metrics.localizationQuality.averageBestRankOfReadFiles,
              top1ReadHitRatePercent:
                report.metrics.localizationQuality.top1ReadHitRatePercent,
              top3ReadHitRatePercent:
                report.metrics.localizationQuality.top3ReadHitRatePercent,
              top5ReadHitRatePercent:
                report.metrics.localizationQuality.top5ReadHitRatePercent,
              repeatedLocalizationCount:
                report.metrics.localizationQuality.repeatedLocalizationCount,
              repeatedLocalizationPercent:
                report.metrics.localizationQuality.repeatedLocalizationPercent,
            }
          : undefined,
      })),
  };
}
