import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RepoScopeBuildInfo } from "./build-info.mjs";
import {
  getInstalledRuntime,
  installLocalRuntime,
  type InstalledRuntime,
  type RuntimeInstallOptions,
} from "./runtime-install.mjs";

const execFileAsync = promisify(execFile);
const GIT_CHECK_TIMEOUT_MS = 15_000;

export type RuntimeUpdateState =
  | "current"
  | "update_available"
  | "unknown_installed_revision"
  | "source_uncheckable"
  | "runtime_missing";

export type RuntimeUpdateCheck = {
  schemaVersion: 1;
  state: RuntimeUpdateState;
  sourceSpec?: string;
  packageVersion?: string;
  installedRevision?: string | null;
  latestRevision?: string | null;
  message: string;
};

export type SourceRevisionResult = {
  revision?: string;
  reason?: string;
};

export type SourceRevisionResolver = (
  sourceSpec: string,
) => Promise<SourceRevisionResult>;

function parseGitHubSource(sourceSpec: string):
  | { owner: string; repo: string; ref: string }
  | undefined {
  const match = /^github:([^/#]+)\/([^#]+)(?:#(.+))?$/.exec(sourceSpec.trim());
  if (!match) return undefined;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ""),
    ref: match[3] || "HEAD",
  };
}

export async function resolveSourceRevision(
  sourceSpec: string,
): Promise<SourceRevisionResult> {
  const github = parseGitHubSource(sourceSpec);
  if (!github) {
    return {
      reason: `Runtime source is not a supported GitHub package spec: ${sourceSpec}`,
    };
  }

  if (/^[a-f0-9]{40}$/i.test(github.ref)) {
    return { revision: github.ref.toLowerCase() };
  }

  const remote = `https://github.com/${github.owner}/${github.repo}.git`;
  const patterns =
    github.ref === "HEAD"
      ? ["HEAD"]
      : [
          `refs/heads/${github.ref}`,
          `refs/tags/${github.ref}`,
          `refs/tags/${github.ref}^{}`,
        ];

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-remote", remote, ...patterns],
      {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
        timeout: GIT_CHECK_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
    );

    const rows = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [revision, ref] = line.split(/\s+/, 2);
        return { revision, ref };
      });

    const preferred =
      rows.find((row) => row.ref === `refs/tags/${github.ref}^{}`) ??
      rows.find((row) => row.ref === `refs/heads/${github.ref}`) ??
      rows.find((row) => row.ref === `refs/tags/${github.ref}`) ??
      rows.find((row) => row.ref === "HEAD");

    if (!preferred || !/^[a-f0-9]{40}$/i.test(preferred.revision)) {
      return {
        reason: `Cannot resolve GitHub ref ${github.ref} for ${github.owner}/${github.repo}`,
      };
    }

    return { revision: preferred.revision.toLowerCase() };
  } catch (error) {
    return {
      reason: `Cannot check Runtime source revision: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export async function readInstalledRuntimeBuildInfo(
  runtime: InstalledRuntime,
): Promise<RepoScopeBuildInfo> {
  const path = join(
    runtime.installDir,
    "node_modules",
    "reposcope",
    "dist",
    "build-info.json",
  );

  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<RepoScopeBuildInfo>;
    if (
      parsed.schemaVersion === 1 &&
      typeof parsed.packageVersion === "string" &&
      (typeof parsed.revision === "string" || parsed.revision === null)
    ) {
      return parsed as RepoScopeBuildInfo;
    }
  } catch {
    // Pre-M3 runtimes do not have embedded build identity.
  }

  return {
    schemaVersion: 1,
    packageVersion: runtime.packageVersion,
    revision: null,
  };
}

export async function checkRuntimeUpdate(options?: {
  runtime?: RuntimeInstallOptions;
  resolver?: SourceRevisionResolver;
}): Promise<RuntimeUpdateCheck> {
  const runtime = await getInstalledRuntime(options?.runtime);
  if (!runtime) {
    return {
      schemaVersion: 1,
      state: "runtime_missing",
      message: "No valid fixed RepoScope Runtime is installed",
    };
  }

  const build = await readInstalledRuntimeBuildInfo(runtime);
  const resolver = options?.resolver ?? resolveSourceRevision;
  const latest = await resolver(runtime.sourceSpec);

  if (!latest.revision) {
    return {
      schemaVersion: 1,
      state: "source_uncheckable",
      sourceSpec: runtime.sourceSpec,
      packageVersion: build.packageVersion,
      installedRevision: build.revision,
      latestRevision: null,
      message: latest.reason || "Runtime source revision cannot be checked",
    };
  }

  if (!build.revision) {
    return {
      schemaVersion: 1,
      state: "unknown_installed_revision",
      sourceSpec: runtime.sourceSpec,
      packageVersion: build.packageVersion,
      installedRevision: null,
      latestRevision: latest.revision,
      message: "Installed Runtime predates build revision tracking; run runtime update once to establish identity",
    };
  }

  const current = build.revision.toLowerCase() === latest.revision.toLowerCase();
  return {
    schemaVersion: 1,
    state: current ? "current" : "update_available",
    sourceSpec: runtime.sourceSpec,
    packageVersion: build.packageVersion,
    installedRevision: build.revision,
    latestRevision: latest.revision,
    message: current
      ? "Installed Runtime matches the current source revision"
      : "A newer/different Runtime source revision is available",
  };
}

export async function updateLocalRuntime(
  options: RuntimeInstallOptions = {},
): Promise<{
  runtime: InstalledRuntime;
  build: RepoScopeBuildInfo;
}> {
  const installed = await getInstalledRuntime(options);
  if (!installed) {
    throw new Error("No installed RepoScope Runtime to update; run runtime install first");
  }

  const runtime = await installLocalRuntime(installed.sourceSpec, options);
  const build = await readInstalledRuntimeBuildInfo(runtime);
  return { runtime, build };
}
