import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { CODEX_MANAGED_MARKERS } from "./codex-setup.mjs";
import { buildCursorMcpServer } from "./cursor-setup.mjs";
import type { SupportedAgent } from "./integration-setup.mjs";
import { buildInstalledRuntimeMcpLaunchSpec } from "./mcp-launch.mjs";
import { parseConfig } from "./runner.js";
import {
  getInstalledRuntime,
  getRuntimeRootPath,
  type RuntimePathOptions,
} from "./runtime-install.mjs";
import { getProjectStatePaths, getStateRootPath, type StatePathOptions } from "./state.js";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "ok" | "warning" | "error";

export type DoctorCheck = {
  id: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type DoctorReport = {
  schemaVersion: 1;
  targetPath: string;
  agent?: SupportedAgent;
  status: DoctorStatus;
  checks: DoctorCheck[];
};

export type DoctorOptions = StatePathOptions & RuntimePathOptions & {
  agent?: SupportedAgent;
};

function overallStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ok";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function nearestExistingParent(path: string): Promise<string | undefined> {
  let current = resolve(path);

  for (;;) {
    try {
      const info = await stat(current);
      if (info.isDirectory()) return current;
    } catch {
      // Keep walking toward the filesystem root.
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function checkNode(): Promise<DoctorCheck> {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return major >= 20
    ? {
        id: "node",
        status: "ok",
        message: `Node.js ${process.versions.node}`,
      }
    : {
        id: "node",
        status: "error",
        message: `Node.js ${process.versions.node} is unsupported; RepoScope requires Node.js 20+`,
      };
}

async function checkGit(projectRoot: string): Promise<DoctorCheck> {
  try {
    const version = await execFileAsync("git", ["--version"], {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024,
    });
    const root = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024,
    });
    const gitRoot = await realpath(root.stdout.trim());

    if (gitRoot !== projectRoot) {
      return {
        id: "git",
        status: "error",
        message: "Target path is not the Git repository root",
        details: { gitRoot },
      };
    }

    return {
      id: "git",
      status: "ok",
      message: version.stdout.trim(),
      details: { gitRoot },
    };
  } catch (error) {
    return {
      id: "git",
      status: "error",
      message: `Git repository check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function checkRipgrep(projectRoot: string): Promise<DoctorCheck> {
  const executable = process.env.REPOSCOPE_RG_PATH?.trim() || "rg";
  try {
    const result = await execFileAsync(executable, ["--version"], {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024,
    });
    return {
      id: "ripgrep",
      status: "ok",
      message: result.stdout.split(/\r?\n/, 1)[0] || "ripgrep available",
    };
  } catch {
    return {
      id: "ripgrep",
      status: "warning",
      message: "ripgrep is unavailable; RepoScope will use the slower Git/Node fallback",
    };
  }
}

async function checkRuntime(options: DoctorOptions): Promise<DoctorCheck> {
  const runtime = await getInstalledRuntime(options);
  if (!runtime) {
    return {
      id: "runtime",
      status: "error",
      message: "No valid fixed local RepoScope runtime is installed",
      details: { runtimeRoot: getRuntimeRootPath(options) },
    };
  }

  return {
    id: "runtime",
    status: "ok",
    message: `RepoScope runtime ${runtime.packageVersion}`,
    details: {
      sourceSpec: runtime.sourceSpec,
      installedAt: runtime.installedAt,
      entryPath: runtime.entryPath,
    },
  };
}

async function checkState(projectRoot: string, options: DoctorOptions): Promise<DoctorCheck> {
  const stateRoot = getStateRootPath(options);
  const existingParent = await nearestExistingParent(stateRoot);
  if (!existingParent) {
    return {
      id: "state",
      status: "error",
      message: "Cannot resolve a writable parent for the RepoScope state root",
      details: { stateRoot },
    };
  }

  try {
    await access(existingParent, fsConstants.W_OK);
    const project = await getProjectStatePaths(projectRoot, options);
    return {
      id: "state",
      status: "ok",
      message: "RepoScope state location is writable",
      details: {
        stateRoot,
        projectId: project.projectId,
        projectDir: project.projectDir,
      },
    };
  } catch (error) {
    return {
      id: "state",
      status: "error",
      message: `RepoScope state location is not writable: ${
        error instanceof Error ? error.message : String(error)
      }`,
      details: { stateRoot, existingParent },
    };
  }
}

async function checkRepoConfig(projectRoot: string): Promise<DoctorCheck> {
  const configPath = join(projectRoot, ".reposcope.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {
        id: "repo-config",
        status: "warning",
        message: ".reposcope.json is not present; repo_run verification commands are unavailable",
      };
    }
    return {
      id: "repo-config",
      status: "error",
      message: `Cannot read .reposcope.json: ${error?.message ?? String(error)}`,
    };
  }

  try {
    const config = parseConfig(raw);
    return {
      id: "repo-config",
      status: "ok",
      message: ".reposcope.json is valid",
      details: { commands: Object.keys(config.commands).sort() },
    };
  } catch (error) {
    return {
      id: "repo-config",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkCursor(
  projectRoot: string,
  runtimeEntryPath: string,
): Promise<DoctorCheck[]> {
  const configPath = join(projectRoot, ".cursor", "mcp.json");
  const expected = buildCursorMcpServer(
    undefined,
    projectRoot,
    buildInstalledRuntimeMcpLaunchSpec(runtimeEntryPath, projectRoot),
  );
  const checks: DoctorCheck[] = [];

  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as any;
    const actual = parsed?.mcpServers?.reposcope;
    if (!actual) {
      checks.push({
        id: "cursor-mcp",
        status: "error",
        message: "Cursor project config does not contain mcpServers.reposcope",
        details: { configPath },
      });
    } else if (
      actual.type !== expected.type ||
      actual.command !== expected.command ||
      JSON.stringify(actual.args) !== JSON.stringify(expected.args)
    ) {
      checks.push({
        id: "cursor-mcp",
        status: "error",
        message: "Cursor RepoScope MCP config is stale or bound to a different runtime/project",
        details: { configPath, expected, actual },
      });
    } else {
      checks.push({
        id: "cursor-mcp",
        status: "ok",
        message: "Cursor RepoScope MCP config matches the installed runtime and project",
        details: { configPath },
      });
    }
  } catch (error: any) {
    checks.push({
      id: "cursor-mcp",
      status: "error",
      message:
        error?.code === "ENOENT"
          ? "Cursor RepoScope project integration is not installed"
          : `Cursor mcp.json is invalid or unreadable: ${error?.message ?? String(error)}`,
      details: { configPath },
    });
  }

  const guidancePaths = [
    join(projectRoot, ".cursor", "rules", "reposcope.mdc"),
    join(projectRoot, ".cursor", "skills", "reposcope", "SKILL.md"),
    join(projectRoot, ".cursor", "skills", "reposcope-benchmark", "SKILL.md"),
  ];
  const missing = [];
  for (const path of guidancePaths) {
    if (!(await pathExists(path))) missing.push(path);
  }
  checks.push(
    missing.length === 0
      ? {
          id: "cursor-guidance",
          status: "ok",
          message: "Cursor RepoScope rule and skills are installed",
        }
      : {
          id: "cursor-guidance",
          status: "warning",
          message: "Cursor RepoScope guidance files are incomplete",
          details: { missing },
        },
  );

  return checks;
}

async function checkCodex(
  projectRoot: string,
  runtimeEntryPath: string,
): Promise<DoctorCheck[]> {
  const configPath = join(projectRoot, ".codex", "config.toml");
  const agentsPath = join(projectRoot, "AGENTS.md");
  const launch = buildInstalledRuntimeMcpLaunchSpec(runtimeEntryPath, projectRoot);
  const expectedCommand = `command = ${JSON.stringify(launch.command)}`;
  const expectedArgs = `args = [${launch.args.map((value) => JSON.stringify(value)).join(", ")}]`;
  const checks: DoctorCheck[] = [];

  try {
    const content = await readFile(configPath, "utf8");
    const valid =
      content.includes(CODEX_MANAGED_MARKERS.mcpStart) &&
      content.includes(CODEX_MANAGED_MARKERS.mcpEnd) &&
      content.includes("[mcp_servers.reposcope]") &&
      content.includes(expectedCommand) &&
      content.includes(expectedArgs);
    checks.push(
      valid
        ? {
            id: "codex-mcp",
            status: "ok",
            message: "Codex RepoScope MCP config matches the installed runtime and project",
            details: { configPath },
          }
        : {
            id: "codex-mcp",
            status: "error",
            message: "Codex RepoScope MCP managed block is missing, stale, or bound to a different runtime/project",
            details: { configPath },
          },
    );
  } catch (error: any) {
    checks.push({
      id: "codex-mcp",
      status: "error",
      message:
        error?.code === "ENOENT"
          ? "Codex RepoScope project integration is not installed"
          : `Codex config.toml is unreadable: ${error?.message ?? String(error)}`,
      details: { configPath },
    });
  }

  try {
    const agents = await readFile(agentsPath, "utf8");
    checks.push(
      agents.includes(CODEX_MANAGED_MARKERS.agentsStart) &&
        agents.includes(CODEX_MANAGED_MARKERS.agentsEnd)
        ? {
            id: "codex-guidance",
            status: "ok",
            message: "Codex RepoScope AGENTS.md guidance is installed",
          }
        : {
            id: "codex-guidance",
            status: "warning",
            message: "Codex AGENTS.md is missing the RepoScope managed guidance block",
            details: { agentsPath },
          },
    );
  } catch (error: any) {
    checks.push({
      id: "codex-guidance",
      status: "warning",
      message:
        error?.code === "ENOENT"
          ? "Codex AGENTS.md RepoScope guidance is not installed"
          : `Codex AGENTS.md is unreadable: ${error?.message ?? String(error)}`,
      details: { agentsPath },
    });
  }

  return checks;
}

export async function buildDoctorReport(
  targetPath: string,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  let projectRoot: string;
  try {
    projectRoot = await realpath(resolve(targetPath));
  } catch (error) {
    const checks: DoctorCheck[] = [
      {
        id: "project",
        status: "error",
        message: `Project path cannot be resolved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ];
    return {
      schemaVersion: 1,
      targetPath: resolve(targetPath),
      agent: options.agent,
      status: "error",
      checks,
    };
  }

  const checks: DoctorCheck[] = [
    {
      id: "project",
      status: "ok",
      message: "Project path resolved",
      details: { projectRoot },
    },
    await checkNode(),
    await checkGit(projectRoot),
    await checkRipgrep(projectRoot),
    await checkRuntime(options),
    await checkState(projectRoot, options),
    await checkRepoConfig(projectRoot),
  ];

  if (options.agent) {
    const runtime = await getInstalledRuntime(options);
    if (runtime) {
      checks.push(
        ...(options.agent === "cursor"
          ? await checkCursor(projectRoot, runtime.entryPath)
          : await checkCodex(projectRoot, runtime.entryPath)),
      );
    } else {
      checks.push({
        id: `${options.agent}-mcp`,
        status: "error",
        message: `Cannot validate ${options.agent} adapter without a valid installed RepoScope runtime`,
      });
    }
  }

  return {
    schemaVersion: 1,
    targetPath: projectRoot,
    agent: options.agent,
    status: overallStatus(checks),
    checks,
  };
}
