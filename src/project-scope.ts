import { platform } from "node:os";
import { normalize, resolve } from "node:path";

export function normalizeProjectPathForComparison(
  path: string,
  platformName: NodeJS.Platform = platform(),
): string {
  const normalized = normalize(resolve(path));
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
