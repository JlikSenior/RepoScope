import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureProjectState,
  type StatePathOptions,
} from "./state";

export const STALE_ACTIVE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const STALE_ATOMIC_TEMP_MS = 60 * 60 * 1000;

export type ProjectStateCleanupResult = {
  removedActiveSessions: number;
  removedTempFiles: number;
  removedLegacyLocators: number;
};

export async function cleanupProjectRuntimeState(
  targetPath: string,
  options: StatePathOptions = {},
  now = Date.now(),
): Promise<ProjectStateCleanupResult> {
  const paths = await ensureProjectState(targetPath, options);
  const entries = await readdir(paths.activeSessionsDir, { withFileTypes: true });
  const result: ProjectStateCleanupResult = {
    removedActiveSessions: 0,
    removedTempFiles: 0,
    removedLegacyLocators: 0,
  };

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const path = join(paths.activeSessionsDir, entry.name);
    let modifiedAt: number;
    try {
      modifiedAt = (await stat(path)).mtimeMs;
    } catch {
      continue;
    }

    if (entry.name.endsWith(".tmp")) {
      if (now - modifiedAt < STALE_ATOMIC_TEMP_MS) continue;
      await rm(path, { force: true });
      result.removedTempFiles += 1;
      continue;
    }

    if (!entry.name.endsWith(".json")) continue;
    if (now - modifiedAt < STALE_ACTIVE_SESSION_MS) continue;

    await rm(path, { force: true });
    result.removedActiveSessions += 1;

    const sessionId = entry.name.slice(0, -".json".length);
    const legacyLocator = join(paths.activeIndexDir, `${sessionId}.json`);
    try {
      await rm(legacyLocator);
      result.removedLegacyLocators += 1;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return result;
}
