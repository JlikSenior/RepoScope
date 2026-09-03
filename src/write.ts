import { resolve } from "node:path";

import {
  applyRepoPatch,
  getRepoDiff,
  getRepoStatus,
  planRepoPatch,
} from "./git";
import {
  getSession,
  invalidateReadFiles,
  recordSessionEvent,
} from "./sessions";
import type {
  RepoApplyPatchResult,
  RepoDiffResult,
  RepoStatusResult,
  TaskSession,
} from "./types";

function requireSessionForRepo(
  sessionId: string,
  targetPath: string,
): TaskSession {
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  if (session.targetPath !== resolve(targetPath)) {
    throw new Error("Session does not belong to this repository");
  }

  return session;
}

export async function getSessionRepoStatus(request: {
  targetPath: string;
  sessionId: string;
}): Promise<RepoStatusResult> {
  requireSessionForRepo(request.sessionId, request.targetPath);
  return getRepoStatus({ targetPath: request.targetPath });
}

export async function applySessionPatch(request: {
  targetPath: string;
  patch: string;
  sessionId: string;
}): Promise<RepoApplyPatchResult> {
  const session = requireSessionForRepo(
    request.sessionId,
    request.targetPath,
  );
  const plan = await planRepoPatch({
    targetPath: request.targetPath,
    patch: request.patch,
  });
  const unreadFiles = plan.existingFiles.filter(
    (file) => !(file in session.readFiles),
  );

  if (unreadFiles.length > 0) {
    throw new Error(
      `Existing files must be read before modification: ${unreadFiles.join(", ")}`,
    );
  }

  const result = await applyRepoPatch({
    targetPath: request.targetPath,
    patch: request.patch,
  });

  invalidateReadFiles(request.sessionId, result.files);
  recordSessionEvent(request.sessionId, {
    type: "write",
    timestamp: new Date().toISOString(),
    files: result.files,
  });

  return result;
}

export async function getSessionRepoDiff(request: {
  targetPath: string;
  budgetTokens: number;
  sessionId: string;
}): Promise<RepoDiffResult> {
  requireSessionForRepo(request.sessionId, request.targetPath);
  return getRepoDiff({
    targetPath: request.targetPath,
    budgetTokens: request.budgetTokens,
  });
}
