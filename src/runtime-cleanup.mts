import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  getRuntimeRootPath,
  type RuntimePathOptions,
} from "./runtime-install.mjs";

export const STALE_RUNTIME_TEMP_MS = 60 * 60 * 1000;

export type RuntimeCleanupResult = {
  runtimeRoot: string;
  removedInstallDirs: number;
  removedCacheDirs: number;
  removedPreviousDirs: number;
};

export async function cleanupRuntimeInstallGarbage(
  options: RuntimePathOptions = {},
  now = Date.now(),
): Promise<RuntimeCleanupResult> {
  const runtimeRoot = getRuntimeRootPath(options);
  const result: RuntimeCleanupResult = {
    runtimeRoot,
    removedInstallDirs: 0,
    removedCacheDirs: 0,
    removedPreviousDirs: 0,
  };

  let entries;
  try {
    entries = await readdir(runtimeRoot, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return result;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    let kind: keyof Pick<
      RuntimeCleanupResult,
      "removedInstallDirs" | "removedCacheDirs" | "removedPreviousDirs"
    > | undefined;

    if (entry.name.startsWith(".install-")) {
      kind = "removedInstallDirs";
    } else if (entry.name.startsWith(".npm-cache-")) {
      kind = "removedCacheDirs";
    } else if (entry.name.startsWith(".previous-")) {
      kind = "removedPreviousDirs";
    } else {
      continue;
    }

    const path = join(runtimeRoot, entry.name);
    let modifiedAt: number;
    try {
      modifiedAt = (await stat(path)).mtimeMs;
    } catch {
      continue;
    }

    if (now - modifiedAt < STALE_RUNTIME_TEMP_MS) continue;

    await rm(path, { recursive: true, force: true });
    result[kind] += 1;
  }

  return result;
}
