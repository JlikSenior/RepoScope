import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import { installLocalRuntime } from "../src/runtime-install.mjs";

const execFileAsync = promisify(execFile);
const REVISION = "cccccccccccccccccccccccccccccccccccccccc";

test("runtime check CLI compares an immutable GitHub source without network access", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-check-cli-"));
  const runtimeRoot = join(root, "runtime");
  const env = {
    ...process.env,
    REPOSCOPE_RUNTIME_DIR: runtimeRoot,
  };

  try {
    await installLocalRuntime(`github:example/reposcope#${REVISION}`, {
      env,
      installer: async ({ stagingDir }) => {
        const packageRoot = join(stagingDir, "node_modules", "reposcope");
        const dist = join(packageRoot, "dist");
        await mkdir(dist, { recursive: true });
        await writeFile(
          join(packageRoot, "package.json"),
          JSON.stringify({ name: "reposcope", version: "0.1.0-test" }),
          "utf8",
        );
        await writeFile(join(dist, "bin.mjs"), "console.log('runtime');\n", "utf8");
        await writeFile(
          join(dist, "build-info.json"),
          JSON.stringify({
            schemaVersion: 1,
            packageVersion: "0.1.0-test",
            revision: REVISION,
          }),
          "utf8",
        );
      },
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/bin.mts", "runtime", "check"],
      {
        cwd: process.cwd(),
        env,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const report = JSON.parse(stdout) as {
      state: string;
      installedRevision: string;
      latestRevision: string;
    };
    assert.equal(report.state, "current");
    assert.equal(report.installedRevision, REVISION);
    assert.equal(report.latestRevision, REVISION);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
