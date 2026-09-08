import { realpathSync } from "node:fs";
import { platform } from "node:os";
import { normalize, resolve } from "node:path";

function canonicalPathForComparison(path: string): string {
  const resolved = resolve(path);

  try {
    // On Windows this collapses long-path / 8.3 aliases and junction/symlink
    // spellings to the same filesystem identity before comparison.
    return realpathSync.native(resolved);
  } catch {
    // Keep diagnostics and validation usable for paths that do not exist yet.
    return normalize(resolved);
  }
}

export function normalizeProjectPathForComparison(
  path: string,
  platformName: NodeJS.Platform = platform(),
): string {
  const normalized = normalize(canonicalPathForComparison(path));
  return platformName === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSameProjectPath(
  left: string,
  right: string,
  platformName: NodeJS.Platform = platform(),
): boolean {
  return (
    normalizeProjectPathForComparison(left, platformName) ===
    normalizeProjectPathForComparison(right, platformName)
  );
}

export function getBoundProjectRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env.REPOSCOPE_BOUND_PROJECT?.trim();
  return value || undefined;
}

export function assertProjectTargetAllowed(
  targetPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platformName: NodeJS.Platform = platform(),
): void {
  const boundProjectRoot = getBoundProjectRoot(env);
  if (!boundProjectRoot) return;

  if (!isSameProjectPath(targetPath, boundProjectRoot, platformName)) {
    throw new Error(
      `RepoScope MCP is bound to a different project: ${boundProjectRoot}`,
    );
  }
}
