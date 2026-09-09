import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type RepoScopeBuildInfo = {
  schemaVersion: 1;
  packageVersion: string;
  revision: string | null;
};

async function readJson(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

export async function readCurrentBuildInfo(): Promise<RepoScopeBuildInfo> {
  const embeddedPath = fileURLToPath(new URL("./build-info.json", import.meta.url));
  const embedded = await readJson(embeddedPath);

  if (
    embedded?.schemaVersion === 1 &&
    typeof embedded.packageVersion === "string" &&
    (typeof embedded.revision === "string" || embedded.revision === null)
  ) {
    return embedded as RepoScopeBuildInfo;
  }

  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = await readJson(packagePath);

  return {
    schemaVersion: 1,
    packageVersion:
      typeof packageJson?.version === "string" ? packageJson.version : "unknown",
    revision: process.env.REPOSCOPE_BUILD_REVISION?.trim() || null,
  };
}
