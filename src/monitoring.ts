import { appendFile, readFile } from "node:fs/promises";

import type {
  MonitoringEvent,
  MonitoringSummary,
  SessionMetrics,
  TaskSession,
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

export function summarizeSession(session: TaskSession): SessionMetrics {
  let searchCount = 0;
  let readCount = 0;
  let writeCount = 0;
  let blockedReadCount = 0;
  let blockedContextCount = 0;

  for (const event of session.events) {
    if (event.type === "search") {
      searchCount += 1;
    }

    if (event.type === "read") {
      readCount += 1;
    }

    if (event.type === "write") {
      writeCount += 1;
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

  return {
    sessionId: session.id,
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
    blockedReadCount,
    blockedContextCount,
    uniqueFilesRead: Object.keys(session.readFiles).length,
    utilizationPercent: Number(utilizationPercent.toFixed(2)),
    toolOverheadTokens,
    toolOverheadPercent: Number(toolOverheadPercent.toFixed(2)),
  };
}
