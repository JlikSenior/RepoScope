import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildCursorMcpServer,
  DEFAULT_NPX_SPEC,
} from "./cursor-setup.mjs";
import { parseConfig } from "./runner.js";
import { getStateRootPath, type StatePathOptions } from "./state.js";

const execFileAsync = promisify(execFile);

export type DoctorCheckStatus = "ok" | "warning" | "error";

export type DoctorCheck = {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type DoctorReport = {
  schemaVersion: 1;
  status: DoctorCheckStatus;
  ok: boolean;
  projectRoot: string;
  stateRoot: string;
  summary: {
    ok: number;
    warnings: number;
    errors: number;
  };
  checks: DoctorCheck[];
};

type JsonObject = Record<string, unknown>;

type DoctorOptions = StatePathOptions & {
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function check(
  id: string,
  status: DoctorCheckStatus,
  message: string,
  details?: Record<string, unknown>,
): DoctorCheck {
  return { id, status, message, ...(details ? { details } : {}) };
}

async function commandVersion(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: process.env,
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    const version = `${result.stdout}${result.stderr}`.trim().split(/\r?\n/)[0] ?? "";
    return { ok: true, version };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function nearestExistingPath(path: string): Promise<string | undefined> {
  let candidate = resolve(path);

  while (true) {
    try {
      await stat(candidate);
      return candidate;
    } catch (error: any) {
      if (error?.code !== "ENOENT") return undefined;
    }

    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function cursorServerMatches(actual: JsonObject): boolean {
  const expected = buildCursorMcpServer(DEFAULT_NPX_SPEC);
  const args = actual.args;

  return (
    actual.type === expected.type &&
    actual.command === expected.command &&
    Array.isArray(args) &&
    args.length === expected.args.length &&
    args.every((value, index) => value === expected.args[index])
  );
}

async function checkCursorConfig(projectRoot: string): Promise<DoctorCheck> {
  const path = join(projectRoot, ".cursor", "mcp.json");

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return check(
        "cursor-mcp",
        "warning",
        "Project Cursor MCP config is not installed.",
        { path },
      );
    }

    return check("cursor-mcp", "error", "Cannot read Cursor MCP config.", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return check("cursor-mcp", "error", "Cursor MCP config is not valid JSON.", {
      path,
    });
  }

  if (!isObject(parsed) || !isObject(parsed.mcpServers)) {
    return check(
      "cursor-mcp",
      "warning",
      "Cursor MCP config does not define an mcpServers object.",
      { path },
    );
  }

  const actual = parsed.mcpServers.reposcope;
  const expected = buildCursorMcpServer(DEFAULT_NPX_SPEC);

  if (!isObject(actual)) {
    return check(
      "cursor-mcp",
      "warning",
      "Cursor MCP config does not contain a reposcope server entry.",
      { path },
    );
  }

  if (!cursorServerMatches(actual)) {
    return check(
      "cursor-mcp",
      "warning",
      "RepoScope MCP entry differs from the current recommended project config.",
      { path, actual, expected },
    );
  }

  return check("cursor-mcp", "ok", "Cursor MCP config matches RepoScope defaults.", {
    path,
    packageSpec: DEFAULT_NPX_SPEC,
  });
}

async function checkRepoScopeConfig(projectRoot: string): Promise<DoctorCheck> {
  const path = join(projectRoot, ".reposcope.json");

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return check(
        "command-policy",
        "warning",
        ".reposcope.json is not present; repo_run will be unavailable until commands are allowlisted.",
        { path },
      );
    }

    return check("command-policy", "error", "Cannot read .reposcope.json.", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const config = parseConfig(raw);
    return check("command-policy", "ok", ".reposcope.json is valid.", {
      path,
      commands: Object.keys(config.commands).sort(),
    });
  } catch (error) {
    return check("command-policy", "error", "Invalid .reposcope.json command policy.", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function buildDoctorReport(
  targetPath: string,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const requestedRoot = resolve(targetPath);
  const stateRoot = getStateRootPath(options);
  const checks: DoctorCheck[] = [];
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);

  checks.push(
    Number.isInteger(nodeMajor) && nodeMajor >= 20
      ? check("node", "ok", `Node.js ${nodeVersion} satisfies RepoScope >=20.`)
      : check("node", "error", `Node.js ${nodeVersion} does not satisfy RepoScope >=20.`),
  );

  let projectRoot = requestedRoot;
  let projectResolved = false;
  try {
    projectRoot = await realpath(requestedRoot);
    projectResolved = true;
    checks.push(check("project", "ok", "Project directory is accessible.", { projectRoot }));
  } catch (error) {
    checks.push(check("project", "error", "Project directory is not accessible.", {
      projectRoot: requestedRoot,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const commandCwd = projectResolved ? projectRoot : process.cwd();
  const [gitVersion, rgVersion, npxVersion] = await Promise.all([
    commandVersion("git", ["--version"], commandCwd),
    commandVersion("rg", ["--version"], commandCwd),
    commandVersion("npx", ["--version"], commandCwd),
  ]);

  checks.push(
    gitVersion.ok
      ? check("git", "ok", "Git is available.", { version: gitVersion.version })
      : check("git", "error", "Git is not available.", { error: gitVersion.error }),
  );
  checks.push(
    rgVersion.ok
      ? check("ripgrep", "ok", "ripgrep is available.", { version: rgVersion.version })
      : check("ripgrep", "error", "ripgrep is not available.", { error: rgVersion.error }),
  );
  checks.push(
    npxVersion.ok
      ? check("npx", "ok", "npx is available.", { version: npxVersion.version })
      : check("npx", "error", "npx is not available.", { error: npxVersion.error }),
  );

  if (projectResolved && gitVersion.ok) {
    try {
      const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: projectRoot,
        env: process.env,
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      const gitRoot = await realpath(result.stdout.trim());

      checks.push(
        gitRoot === projectRoot
          ? check("git-root", "ok", "Target project is the Git repository root.", {
              gitRoot,
            })
          : check(
              "git-root",
              "error",
              "Target project is inside a Git repository but is not its root.",
              { projectRoot, gitRoot },
            ),
      );
    } catch (error) {
      checks.push(check("git-root", "error", "Target project is not a Git repository.", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  } else {
    checks.push(
      check("git-root", "error", "Git repository root could not be verified."),
    );
  }

  const writableAncestor = await nearestExistingPath(stateRoot);
  if (!writableAncestor) {
    checks.push(
      check("state-root", "error", "RepoScope state path has no accessible existing ancestor.", {
        stateRoot,
      }),
    );
  } else {
    try {
      const ancestorStat = await stat(writableAncestor);
      if (!ancestorStat.isDirectory()) {
        throw new Error("nearest existing state path is not a directory");
      }
      await access(writableAncestor, constants.W_OK);
      checks.push(
        check("state-root", "ok", "RepoScope state location is writable.", {
          stateRoot,
          writableAncestor,
        }),
      );
    } catch (error) {
      checks.push(
        check("state-root", "error", "RepoScope state location is not writable as a directory.", {
          stateRoot,
          writableAncestor,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (projectResolved) {
    checks.push(await checkRepoScopeConfig(projectRoot));
    checks.push(await checkCursorConfig(projectRoot));

    const rulePath = join(projectRoot, ".cursor", "rules", "reposcope.mdc");
    checks.push(
      (await fileExists(rulePath))
        ? check("cursor-rule", "ok", "RepoScope Cursor rule is installed.", { path: rulePath })
        : check("cursor-rule", "warning", "RepoScope Cursor rule is not installed.", {
            path: rulePath,
          }),
    );

    const skillPaths = [
      join(projectRoot, ".cursor", "skills", "reposcope", "SKILL.md"),
      join(projectRoot, ".cursor", "skills", "reposcope-benchmark", "SKILL.md"),
    ];
    const missingSkills: string[] = [];
    for (const path of skillPaths) {
      if (!(await fileExists(path))) missingSkills.push(path);
    }
    checks.push(
      missingSkills.length === 0
        ? check("cursor-skills", "ok", "RepoScope Cursor skills are installed.", {
            paths: skillPaths,
          })
        : check("cursor-skills", "warning", "One or more RepoScope Cursor skills are missing.", {
            missing: missingSkills,
          }),
    );
  }

  const summary = {
    ok: checks.filter((item) => item.status === "ok").length,
    warnings: checks.filter((item) => item.status === "warning").length,
    errors: checks.filter((item) => item.status === "error").length,
  };
  const status: DoctorCheckStatus =
    summary.errors > 0 ? "error" : summary.warnings > 0 ? "warning" : "ok";

  return {
    schemaVersion: 1,
    status,
    ok: summary.errors === 0,
    projectRoot,
    stateRoot,
    summary,
    checks,
  };
}
