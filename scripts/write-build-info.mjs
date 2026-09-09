import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(join(repoRoot, "package.json"), "utf8"),
);

function resolveRevision() {
  const configured = process.env.REPOSCOPE_BUILD_REVISION?.trim();
  if (configured) return configured;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const outputPath = join(repoRoot, "dist", "build-info.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      packageVersion: packageJson.version,
      revision: resolveRevision(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
