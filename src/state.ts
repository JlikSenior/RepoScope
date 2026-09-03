import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";

import { OUTPUT_FILES } from "./output";

export type ProjectStatePaths = {
  stateRoot: string;
  projectId: string;
  projectDir: string;
  cliDir: string;
  metadataPath: string;
  contextPacketPath: string;
  repoMapPath: string;
  monitoringLogPath: string;
  monitoringSummaryPath: string;
};

export type StatePathOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platformName?: NodeJS.Platform;
};

function stateRootFromEnvironment(options: StatePathOptions = {}): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platformName = options.platformName ?? platform();

  if (env.REPOSCOPE_STATE_DIR) {
    return resolve(env.REPOSCOPE_STATE_DIR);
  }

  if (env.XDG_STATE_HOME) {
    return join(resolve(env.XDG_STATE_HOME), "reposcope");
  }

  if (platformName === "win32" && env.LOCALAPPDATA) {
    return join(resolve(env.LOCALAPPDATA), "RepoScope", "state");
  }

  if (platformName === "darwin") {
    return join(homeDir, "Library", "Application Support", "RepoScope", "state");
  }

  return join(homeDir, ".local", "state", "reposcope");
}

function projectIdForPath(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 20);
}

export async function getProjectStatePaths(
  targetPath: string,
  options: StatePathOptions = {},
): Promise<ProjectStatePaths> {
  const canonicalPath = await realpath(resolve(targetPath));
  const stateRoot = stateRootFromEnvironment(options);
  const projectId = projectIdForPath(canonicalPath);
  const projectDir = join(stateRoot, "projects", projectId);
  const cliDir = join(projectDir, "cli");

  return {
    stateRoot,
    projectId,
    projectDir,
    cliDir,
    metadataPath: join(projectDir, "project.json"),
    contextPacketPath: join(cliDir, OUTPUT_FILES.contextPacket),
    repoMapPath: join(cliDir, OUTPUT_FILES.repoMap),
    monitoringLogPath: join(cliDir, OUTPUT_FILES.monitoringLog),
    monitoringSummaryPath: join(cliDir, OUTPUT_FILES.monitoringSummary),
  };
}

export async function ensureProjectState(
  targetPath: string,
  options: StatePathOptions = {},
): Promise<ProjectStatePaths> {
  const canonicalPath = await realpath(resolve(targetPath));
  const paths = await getProjectStatePaths(canonicalPath, options);

  await mkdir(paths.cliDir, { recursive: true });
  await writeFile(
    paths.metadataPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId: paths.projectId,
        name: basename(canonicalPath),
        targetPath: canonicalPath,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return paths;
}
