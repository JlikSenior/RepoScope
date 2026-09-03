import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { getEncoding } from "js-tiktoken";

import type {
  RepoApplyPatchRequest,
  RepoApplyPatchResult,
  RepoDiffRequest,
  RepoDiffResult,
  RepoStatusRequest,
  RepoStatusResult,
} from "./types";

const encoding = getEncoding("cl100k_base");

type ProcessResult = {
  stdout: string;
  stderr: string;
};

export type RepoPatchPlan = {
  targetPath: string;
  files: string[];
  existingFiles: string[];
  newFiles: string[];
};

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  input?: string,
  allowedExitCodes: number[] = [0],
): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? -1;

      if (!allowedExitCodes.includes(exitCode)) {
        reject(
          new Error(
            stderr.trim() || `${command} exited with code ${exitCode}`,
          ),
        );
        return;
      }

      resolvePromise({ stdout, stderr });
    });

    child.stdin.end(input);
  });
}

async function resolveGitRoot(targetPath: string): Promise<string> {
  const requestedRoot = await realpath(resolve(targetPath));
  const { stdout } = await runProcess(
    "git",
    ["-C", requestedRoot, "rev-parse", "--show-toplevel"],
    requestedRoot,
  );
  const gitRoot = await realpath(stdout.trim());

  if (gitRoot !== requestedRoot) {
    throw new Error("targetPath must be the Git repository root");
  }

  return gitRoot;
}

function validatePatchPath(path: string): string {
  const normalized = path.trim();

  if (!normalized || normalized === "/dev/null") {
    return normalized;
  }

  if (
    isAbsolute(normalized) ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.includes("\\")
  ) {
    throw new Error(`Unsafe patch path: ${normalized}`);
  }

  const segments = normalized.split("/");

  if (segments.includes("..") || segments.includes(".git")) {
    throw new Error(`Unsafe patch path: ${normalized}`);
  }

  return normalized;
}

function extractPatchFiles(patch: string): string[] {
  if (!patch.trim()) {
    throw new Error("Patch is empty");
  }

  if (patch.includes("GIT binary patch")) {
    throw new Error("Binary patches are not supported");
  }

  const files = new Set<string>();

  for (const line of patch.split("\n")) {
    let rawPath: string | undefined;

    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      rawPath = line.slice(4).split("\t", 1)[0]?.trim();
    } else if (line.startsWith("rename from ")) {
      rawPath = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      rawPath = line.slice("rename to ".length).trim();
    }

    if (!rawPath || rawPath === "/dev/null") {
      continue;
    }

    if (rawPath.startsWith("a/") || rawPath.startsWith("b/")) {
      rawPath = rawPath.slice(2);
    }

    if (rawPath.startsWith('"')) {
      throw new Error("Quoted patch paths are not supported yet");
    }

    const safePath = validatePatchPath(rawPath);

    if (safePath) {
      files.add(safePath);
    }
  }

  if (files.size === 0) {
    throw new Error("Patch does not contain any supported file paths");
  }

  return [...files];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function planRepoPatch(
  request: RepoApplyPatchRequest,
): Promise<RepoPatchPlan> {
  const targetPath = await resolveGitRoot(request.targetPath);
  const files = extractPatchFiles(request.patch);
  const existingFiles: string[] = [];
  const newFiles: string[] = [];

  for (const file of files) {
    if (await fileExists(resolve(targetPath, file))) {
      existingFiles.push(file);
    } else {
      newFiles.push(file);
    }
  }

  return {
    targetPath,
    files,
    existingFiles,
    newFiles,
  };
}

export async function getRepoStatus(
  request: RepoStatusRequest,
): Promise<RepoStatusResult> {
  const targetPath = await resolveGitRoot(request.targetPath);
  const { stdout } = await runProcess(
    "git",
    ["-C", targetPath, "status", "--short", "--untracked-files=normal"],
    targetPath,
  );

  return {
    targetPath,
    lines: stdout.split("\n").filter(Boolean),
  };
}

export async function applyRepoPatch(
  request: RepoApplyPatchRequest,
): Promise<RepoApplyPatchResult> {
  const plan = await planRepoPatch(request);
  const commonArgs = ["--recount", "--whitespace=nowarn", "-"];

  await runProcess(
    "git",
    ["-C", plan.targetPath, "apply", "--check", ...commonArgs],
    plan.targetPath,
    request.patch,
  );
  await runProcess(
    "git",
    ["-C", plan.targetPath, "apply", ...commonArgs],
    plan.targetPath,
    request.patch,
  );

  return {
    targetPath: plan.targetPath,
    files: plan.files,
  };
}

export async function getRepoDiff(
  request: RepoDiffRequest,
): Promise<RepoDiffResult> {
  const targetPath = await resolveGitRoot(request.targetPath);
  const { stdout } = await runProcess(
    "git",
    ["-C", targetPath, "diff", "--no-ext-diff", "--unified=3", "--", "."],
    targetPath,
  );
  const tokens = encoding.encode(stdout);

  if (tokens.length <= request.budgetTokens) {
    return {
      targetPath,
      diff: stdout,
      tokens: tokens.length,
      truncated: false,
    };
  }

  return {
    targetPath,
    diff: encoding.decode(tokens.slice(0, request.budgetTokens)),
    tokens: request.budgetTokens,
    truncated: true,
  };
}
