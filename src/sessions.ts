import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { scanDirectory } from "./scanner";
import type {
  SessionEvent,
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
    budgetTokens: request.budgetTokens,
    usedTokens: 0,
    deliveredTokens: 0,
    deliveredByTool: {},
    wholeRepoTokens,
    readFiles: {},
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

export function getSession(sessionId: string): TaskSession | undefined {
  return sessions.get(sessionId);
}

export function recordSessionEvent(
  sessionId: string,
  event: SessionEvent,
): void {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

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
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  return filePath in session.readFiles;
}

export function recordReadFile(
  sessionId: string,
  filePath: string,
  tokens: number,
): void {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  session.readFiles[filePath] = tokens;
}

export function invalidateReadFiles(
  sessionId: string,
  files: string[],
): void {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  for (const file of files) {
    delete session.readFiles[file];
  }
}

export function consumeTokens(sessionId: string, tokens: number) {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

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
