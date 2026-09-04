import { randomUUID } from "node:crypto";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureProjectState,
  getProjectStatePaths,
  getStateRootPath,
  type StatePathOptions,
} from "./state";
import type { TaskSession } from "./types";

type ActiveSessionLocator = {
  schemaVersion: 1;
  projectId: string;
};

type ActiveSessionSnapshot = {
  schemaVersion: 1;
  projectId: string;
  session: TaskSession;
};

const checkpointWrites = new Map<string, Promise<string>>();

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function isTaskSession(value: unknown): value is TaskSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<TaskSession>;

  return (
    typeof session.id === "string" &&
    typeof session.targetPath === "string" &&
    typeof session.task === "string" &&
    (session.status === "active" || session.status === "finished") &&
    typeof session.budgetTokens === "number" &&
    typeof session.usedTokens === "number" &&
    typeof session.wholeRepoTokens === "number" &&
    typeof session.deliveredTokens === "number" &&
    Array.isArray(session.events) &&
    typeof session.readFiles === "object" &&
    session.readFiles !== null &&
    typeof session.readRanges === "object" &&
    session.readRanges !== null &&
    typeof session.fullyReadFiles === "object" &&
    session.fullyReadFiles !== null &&
    typeof session.deliveredByTool === "object" &&
    session.deliveredByTool !== null &&
    typeof session.createdAt === "string"
  );
}

async function cleanupPaths(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}

async function writeCheckpoint(
  session: TaskSession,
  options: StatePathOptions,
): Promise<string> {
  const paths = await ensureProjectState(session.targetPath, options);
  const snapshotPath = join(paths.activeSessionsDir, `${session.id}.json`);
  const locatorPath = join(paths.activeIndexDir, `${session.id}.json`);
  const snapshot: ActiveSessionSnapshot = {
    schemaVersion: 1,
    projectId: paths.projectId,
    session,
  };
  const locator: ActiveSessionLocator = {
    schemaVersion: 1,
    projectId: paths.projectId,
  };

  // Write the project-local snapshot first. A locator must never point at a
  // snapshot that has not been fully committed yet.
  await atomicWriteJson(snapshotPath, snapshot);
  await atomicWriteJson(locatorPath, locator);
  return snapshotPath;
}

export async function persistSessionCheckpoint(
  session: TaskSession,
  options: StatePathOptions = {},
): Promise<string> {
  const previous = checkpointWrites.get(session.id);
  const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
    .then(() => writeCheckpoint(session, options));

  checkpointWrites.set(session.id, current);

  try {
    return await current;
  } finally {
    if (checkpointWrites.get(session.id) === current) {
      checkpointWrites.delete(session.id);
    }
  }
}

export async function removeSessionCheckpoint(
  session: Pick<TaskSession, "id" | "targetPath">,
  options: StatePathOptions = {},
): Promise<void> {
  const pending = checkpointWrites.get(session.id);
  if (pending) await pending.catch(() => undefined);

  const paths = await getProjectStatePaths(session.targetPath, options);
  await cleanupPaths(
    join(paths.activeSessionsDir, `${session.id}.json`),
    join(paths.activeIndexDir, `${session.id}.json`),
  );
}

export async function loadActiveSessionCheckpoint(
  sessionId: string,
  options: StatePathOptions = {},
): Promise<TaskSession | undefined> {
  const pending = checkpointWrites.get(sessionId);
  if (pending) await pending.catch(() => undefined);

  const stateRoot = getStateRootPath(options);
  const locatorPath = join(stateRoot, "active", `${sessionId}.json`);

  let locator: ActiveSessionLocator;
  try {
    locator = JSON.parse(await readFile(locatorPath, "utf8")) as ActiveSessionLocator;
  } catch {
    return undefined;
  }

  if (
    locator.schemaVersion !== 1 ||
    typeof locator.projectId !== "string" ||
    !/^[a-f0-9]{20}$/.test(locator.projectId)
  ) {
    await cleanupPaths(locatorPath);
    return undefined;
  }

  const projectDir = join(stateRoot, "projects", locator.projectId);
  const snapshotPath = join(projectDir, "active", `${sessionId}.json`);
  const finishedReportPath = join(projectDir, "sessions", `${sessionId}.json`);

  // A final report wins over any stale active checkpoint left behind by a
  // process that died between finishing and cleanup.
  if (await pathExists(finishedReportPath)) {
    await cleanupPaths(snapshotPath, locatorPath);
    return undefined;
  }

  let snapshot: ActiveSessionSnapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as ActiveSessionSnapshot;
  } catch {
    await cleanupPaths(locatorPath);
    return undefined;
  }

  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.projectId !== locator.projectId ||
    !isTaskSession(snapshot.session) ||
    snapshot.session.id !== sessionId ||
    snapshot.session.status !== "active"
  ) {
    await cleanupPaths(snapshotPath, locatorPath);
    return undefined;
  }

  try {
    const paths = await getProjectStatePaths(snapshot.session.targetPath, options);
    if (paths.projectId !== locator.projectId) {
      await cleanupPaths(snapshotPath, locatorPath);
      return undefined;
    }
  } catch {
    return undefined;
  }

  return snapshot.session;
}
