import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { getEncoding } from "js-tiktoken";

import { scanDirectory } from "./scanner";
const encoding = getEncoding("cl100k_base");

import type {
  SessionEvent,
  StartSessionRequest,
  StartSessionResult,
  TaskSession,
} from "./types";

const sessions = new Map<string, TaskSession>();

export async function startSession(
  request: StartSessionRequest,
): Promise<StartSessionResult> {
  const id = randomUUID();

  const targetPath = resolve(request.targetPath);

  const files = await scanDirectory(targetPath);

  let wholeRepoTokens = 0;

  for (const file of files) {
    const content = await readFile(file, "utf8");

    wholeRepoTokens += encoding.encode(content).length;
  }

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
