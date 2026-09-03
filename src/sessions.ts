import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { scanDirectory } from "./scanner";
import type {
  RepoLineRange,
  SessionEvent,
  SessionOutcome,
  StartSessionRequest,
  StartSessionResult,
  TaskSession,
} from "./types";

const sessions = new Map<string, TaskSession>();

async function estimateWholeRepoTokens(files: string[]): Promise<number> {
  const sizes = await Promise.all(
    files.map(async (file) => {
      const fileStat = await stat(file);
      return Math.ceil(fileStat.size / 4);
    }),
  );

  return sizes.reduce((sum, tokens) => sum + tokens, 0);
}

function mergeRanges(ranges: RepoLineRange[]): RepoLineRange[] {
  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged: RepoLineRange[] = [];

  for (const range of sorted) {
    const previous = merged.at(-1);

    if (!previous || range.startLine > previous.endLine + 1) {
      merged.push(range);
      continue;
    }

    previous.endLine = Math.max(previous.endLine, range.endLine);
  }

  return merged;
}

export async function startSession(
  request: StartSessionRequest,
): Promise<StartSessionResult> {
  const id = randomUUID();
  const targetPath = resolve(request.targetPath);
  const files = await scanDirectory(targetPath);
  const wholeRepoTokens = await estimateWholeRepoTokens(files);

  const session: TaskSession = {
    id,
    targetPath,
    task: request.task,
    status: "active",
    budgetTokens: request.budgetTokens,
    usedTokens: 0,
    deliveredTokens: 0,
    deliveredByTool: {},
    wholeRepoTokens,
    readFiles: {},
    readRanges: {},
    fullyReadFiles: {},
    events: [],
    createdAt: new Date().toISOString(),
  };

  sessions.set(id, session);

  return {
    sessionId: id,
    budgetTokens: session.budgetTokens,
    usedTokens: 0,
    remainingTokens: session.budgetTokens,
    wholeRepoTokens,
  };
}

export function getSessionRecord(sessionId: string): TaskSession | undefined {
  return sessions.get(sessionId);
}

export function getSession(sessionId: string): TaskSession | undefined {
  const session = sessions.get(sessionId);

  if (session?.status === "finished") {
    throw new Error("Session is finished");
  }

  return session;
}

export function getActiveSession(sessionId: string): TaskSession {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  if (session.status !== "active") {
    throw new Error("Session is finished");
  }

  return session;
}

export function finishSession(
  sessionId: string,
  outcome: SessionOutcome,
  note?: string,
): TaskSession {
  const session = getActiveSession(sessionId);
  const finishedAt = new Date().toISOString();
  const normalizedNote = note?.trim() || undefined;

  session.status = "finished";
  session.outcome = outcome;
  session.note = normalizedNote;
  session.finishedAt = finishedAt;
  session.events.push({
    type: "finish",
    timestamp: finishedAt,
    outcome,
    note: normalizedNote,
  });

  return session;
}

export function recordSessionEvent(
  sessionId: string,
  event: SessionEvent,
): void {
  const session = getActiveSession(sessionId);
  session.events.push(event);
}

export function recordDeliveredTokens(
  sessionId: string,
  tool: string,
  tokens: number,
): void {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  session.deliveredTokens += tokens;
  session.deliveredByTool[tool] =
    (session.deliveredByTool[tool] ?? 0) + tokens;
}

export function hasReadFile(sessionId: string, filePath: string): boolean {
  const session = getActiveSession(sessionId);
  return Boolean(session.fullyReadFiles[filePath]);
}

export function getReadRanges(
  sessionId: string,
  filePath: string,
): RepoLineRange[] {
  const session = getActiveSession(sessionId);
  return session.readRanges[filePath]?.map((range) => ({ ...range })) ?? [];
}

export function recordReadRange(
  sessionId: string,
  filePath: string,
  range: RepoLineRange,
  tokens: number,
  totalLines: number,
): void {
  const session = getActiveSession(sessionId);
  const merged = mergeRanges([
    ...(session.readRanges[filePath] ?? []),
    range,
  ]);

  session.readRanges[filePath] = merged;
  session.readFiles[filePath] = (session.readFiles[filePath] ?? 0) + tokens;

  if (
    merged.length === 1 &&
    merged[0].startLine <= 1 &&
    merged[0].endLine >= totalLines
  ) {
    session.fullyReadFiles[filePath] = true;
  }
}

export function recordReadFile(
  sessionId: string,
  filePath: string,
  tokens: number,
  totalLines?: number,
): void {
  const session = getActiveSession(sessionId);
  session.readFiles[filePath] = (session.readFiles[filePath] ?? 0) + tokens;
  session.fullyReadFiles[filePath] = true;

  if (totalLines && totalLines > 0) {
    session.readRanges[filePath] = [{ startLine: 1, endLine: totalLines }];
  }
}

export function invalidateReadFiles(
  sessionId: string,
  files: string[],
): void {
  const session = getActiveSession(sessionId);

  for (const file of files) {
    delete session.readFiles[file];
    delete session.readRanges[file];
    delete session.fullyReadFiles[file];
  }
}

export function consumeTokens(sessionId: string, tokens: number) {
  const session = getActiveSession(sessionId);
  const remainingTokens = session.budgetTokens - session.usedTokens;

  if (tokens > remainingTokens) {
    return {
      accepted: false,
      usedTokens: session.usedTokens,
      remainingTokens,
    };
  }

  session.usedTokens += tokens;

  return {
    accepted: true,
    usedTokens: session.usedTokens,
    remainingTokens: session.budgetTokens - session.usedTokens,
  };
}
