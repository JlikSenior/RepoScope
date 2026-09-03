import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { getEncoding } from "js-tiktoken";

import {
  getSession,
  recordSessionEvent,
} from "./sessions";
import type {
  RepoRunResult,
  TaskSession,
} from "./types";

const encoding = getEncoding("cl100k_base");
const CONFIG_FILE = ".reposcope.json";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_CAPTURE_CHARS = 1_000_000;

type RepoScopeConfig = {
  commands: Record<string, string[]>;
};

type CapturedProcess = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  captureTruncated: boolean;
};

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

async function resolveGitRoot(targetPath: string): Promise<string> {
  const requestedRoot = await realpath(resolve(targetPath));

  const result = await captureProcess(
    "git",
    ["rev-parse", "--show-toplevel"],
    requestedRoot,
    10_000,
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "targetPath is not a Git repository");
  }

  const gitRoot = await realpath(result.stdout.trim());

  if (gitRoot !== requestedRoot) {
    throw new Error("targetPath must be the Git repository root");
  }

  return gitRoot;
}

function parseConfig(raw: string): RepoScopeConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${CONFIG_FILE} is not valid JSON`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${CONFIG_FILE} must contain an object`);
  }

  const commands = (parsed as { commands?: unknown }).commands;

  if (!commands || typeof commands !== "object" || Array.isArray(commands)) {
    throw new Error(`${CONFIG_FILE} must define a commands object`);
  }

  const validated: Record<string, string[]> = {};

  for (const [name, argv] of Object.entries(commands)) {
    if (!/^[A-Za-z0-9._:-]+$/.test(name)) {
      throw new Error(`Invalid command name in ${CONFIG_FILE}: ${name}`);
    }

    if (
      !Array.isArray(argv) ||
      argv.length === 0 ||
      argv.length > 64 ||
      argv.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      throw new Error(`Command ${name} must be a non-empty string array`);
    }

    const executable = argv[0];

    if (
      basename(executable) !== executable ||
      executable.includes("\\") ||
      executable.includes("\0")
    ) {
      throw new Error(`Unsafe executable for command ${name}`);
    }

    validated[name] = argv;
  }

  return { commands: validated };
}

async function loadConfig(targetPath: string): Promise<RepoScopeConfig> {
  const root = await resolveGitRoot(targetPath);

  let raw: string;

  try {
    raw = await readFile(join(root, CONFIG_FILE), "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `${CONFIG_FILE} not found. Define allowlisted repository commands first.`,
      );
    }

    throw error;
  }

  return parseConfig(raw);
}

function appendCaptured(current: string, chunk: string): [string, boolean] {
  if (current.length >= MAX_CAPTURE_CHARS) {
    return [current, true];
  }

  const remaining = MAX_CAPTURE_CHARS - current.length;

  if (chunk.length <= remaining) {
    return [current + chunk, false];
  }

  return [current + chunk.slice(0, remaining), true];
}

function captureProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CapturedProcess> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let captureTruncated = false;
    let timedOut = false;
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      const [next, truncated] = appendCaptured(stdout, chunk);
      stdout = next;
      captureTruncated ||= truncated;
    });

    child.stderr.on("data", (chunk: string) => {
      const [next, truncated] = appendCaptured(stderr, chunk);
      stderr = next;
      captureTruncated ||= truncated;
    });

    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        captureTruncated,
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    }, timeoutMs);

    timer.unref();
  });
}

function renderOutput(
  commandName: string,
  result: CapturedProcess,
  durationMs: number,
): string {
  const parts = [
    `COMMAND ${commandName}`,
    `EXIT ${result.exitCode ?? "null"}`,
    `DURATION_MS ${durationMs}`,
  ];

  if (result.signal) {
    parts.push(`SIGNAL ${result.signal}`);
  }

  if (result.timedOut) {
    parts.push("TIMED_OUT true");
  }

  if (result.stdout) {
    parts.push(`STDOUT\n${result.stdout}`);
  }

  if (result.stderr) {
    parts.push(`STDERR\n${result.stderr}`);
  }

  return parts.join("\n");
}

export async function listAllowedCommands(request: {
  targetPath: string;
  sessionId: string;
}): Promise<string[]> {
  requireSessionForRepo(request.sessionId, request.targetPath);
  const config = await loadConfig(request.targetPath);
  return Object.keys(config.commands).sort();
}

export async function runAllowedCommand(request: {
  targetPath: string;
  command: string;
  sessionId: string;
  budgetTokens: number;
  timeoutMs?: number;
}): Promise<RepoRunResult> {
  requireSessionForRepo(request.sessionId, request.targetPath);

  if (!Number.isInteger(request.budgetTokens) || request.budgetTokens <= 0) {
    throw new Error("budgetTokens must be a positive integer");
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(`timeoutMs must be between 1000 and ${MAX_TIMEOUT_MS}`);
  }

  const root = await resolveGitRoot(request.targetPath);
  const config = await loadConfig(root);
  const argv = config.commands[request.command];

  if (!argv) {
    throw new Error(`Command is not allowlisted: ${request.command}`);
  }

  const startedAt = Date.now();
  const processResult = await captureProcess(
    argv[0],
    argv.slice(1),
    root,
    timeoutMs,
  );
  const durationMs = Date.now() - startedAt;
  const rendered = renderOutput(request.command, processResult, durationMs);
  const encoded = encoding.encode(rendered);
  const tokenTruncated = encoded.length > request.budgetTokens;
  const output = tokenTruncated
    ? encoding.decode(encoded.slice(0, request.budgetTokens))
    : rendered;
  const truncated = processResult.captureTruncated || tokenTruncated;

  recordSessionEvent(request.sessionId, {
    type: "run",
    timestamp: new Date().toISOString(),
    command: request.command,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    durationMs,
  });

  return {
    targetPath: root,
    command: request.command,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    durationMs,
    output,
    outputTokens: Math.min(encoded.length, request.budgetTokens),
    truncated,
  };
}
