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
    searchCount: number;
    readCount: number;
    sourceReductionPercent: number;
    netContextReductionPercent: number;
    utilizationPercent: number;
    toolOverheadPercent: number;
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
    searchCount: number;
    readCount: number;
    sourceReductionPercent: number;
    netContextReductionPercent: number;
  }>;
};

function round(value: number): number {
  return Number(value.toFixed(2));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
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

  const metric = <K extends keyof SessionFinishReport["metrics"]>(key: K) =>
    reports
      .map((report) => report.metrics[key])
      .filter((value): value is number => typeof value === "number");

  return {
    schemaVersion: 1,
    projectId: paths.projectId,
    targetPath,
    stateDirectory: paths.projectDir,
    totalSessions: reports.length,
    outcomes,
    verification,
    averages: {
      usedTokens: average(metric("usedTokens")),
      deliveredTokens: average(metric("deliveredTokens")),
      uniqueFilesRead: average(metric("uniqueFilesRead")),
      searchCount: average(metric("searchCount")),
      readCount: average(metric("readCount")),
      sourceReductionPercent: average(metric("sourceReductionPercent")),
      netContextReductionPercent: average(metric("netContextReductionPercent")),
      utilizationPercent: average(metric("utilizationPercent")),
      toolOverheadPercent: average(metric("toolOverheadPercent")),
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
        searchCount: report.metrics.searchCount,
        readCount: report.metrics.readCount,
        sourceReductionPercent: report.metrics.sourceReductionPercent,
        netContextReductionPercent: report.metrics.netContextReductionPercent,
      })),
  };
}
