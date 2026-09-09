import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ensureLocalRuntime,
  getInstalledRuntime,
  getRuntimeRootPath,
  installLocalRuntime,
} from "../src/runtime-install.mjs";

async function fakePackageInstall(
  stagingDir: string,
  version: string,
): Promise<void> {
  const packageRoot = join(stagingDir, "node_modules", "reposcope");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "reposcope", version }),
    "utf8",
  );
  await writeFile(
    join(packageRoot, "dist", "bin.mjs"),
    "console.log('runtime');\n",
    "utf8",
  );
}

async function missing(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

test("runtime root follows platform data conventions", () => {
  assert.equal(
    getRuntimeRootPath({
      platformName: "win32",
      homeDir: "C:\\Users\\test",
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
    }),
    "C:\\Users\\test\\AppData\\Local\\RepoScope\\runtime",
  );

  assert.equal(
    getRuntimeRootPath({
      platformName: "linux",
      homeDir: "/home/test",
      env: { XDG_DATA_HOME: "/data" },
    }),
    "/data/reposcope/runtime",
  );

  assert.equal(
    getRuntimeRootPath({
      platformName: "linux",
      homeDir: "/home/test",
      env: { REPOSCOPE_RUNTIME_DIR: "/custom/reposcope-runtime" },
    }),
    "/custom/reposcope-runtime",
  );
});

test("runtime install atomically publishes a validated current runtime and cleans install cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-test-"));
  const runtimeRoot = join(root, "runtime");
  let installCalls = 0;
  let observedCacheDir = "";

  try {
    const options = {
      env: { REPOSCOPE_RUNTIME_DIR: runtimeRoot },
      installer: async ({ stagingDir, cacheDir }: { stagingDir: string; cacheDir: string }) => {
        installCalls += 1;
        observedCacheDir = cacheDir;
        await mkdir(cacheDir, { recursive: true });
        await writeFile(join(cacheDir, "temporary-cache"), "cache", "utf8");
        await fakePackageInstall(stagingDir, "0.1.0-test");
      },
    };

    const installed = await ensureLocalRuntime("example:source", options);
    assert.equal(installed.sourceSpec, "example:source");
    assert.equal(installed.packageVersion, "0.1.0-test");
    assert.equal(installCalls, 1);
    assert.match(installed.entryPath, /current[\\/]node_modules[\\/]reposcope[\\/]dist[\\/]bin\.mjs$/);
    assert.equal(await readFile(installed.entryPath, "utf8"), "console.log('runtime');\n");
    assert.equal(await missing(observedCacheDir), true);

    const manifest = await getInstalledRuntime({
      env: { REPOSCOPE_RUNTIME_DIR: runtimeRoot },
    });
    assert(manifest);
    assert.equal(manifest.entryPath, installed.entryPath);

    const reused = await ensureLocalRuntime("example:source", options);
    assert.equal(reused.entryPath, installed.entryPath);
    assert.equal(installCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed runtime replacement leaves the previous current runtime usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-rollback-"));
  const runtimeRoot = join(root, "runtime");
  const env = { REPOSCOPE_RUNTIME_DIR: runtimeRoot };

  try {
    const first = await installLocalRuntime("source:first", {
      env,
      installer: async ({ stagingDir }) => fakePackageInstall(stagingDir, "1.0.0"),
    });
    const originalContent = await readFile(first.entryPath, "utf8");

    await assert.rejects(
      installLocalRuntime("source:broken", {
        env,
        installer: async ({ stagingDir }) => {
          const packageRoot = join(stagingDir, "node_modules", "reposcope");
          await mkdir(packageRoot, { recursive: true });
          await writeFile(
            join(packageRoot, "package.json"),
            JSON.stringify({ name: "reposcope", version: "2.0.0" }),
            "utf8",
          );
        },
      }),
      /runtime entry is missing/,
    );

    assert.equal(await readFile(first.entryPath, "utf8"), originalContent);
    const restored = await getInstalledRuntime({ env });
    assert(restored);
    assert.equal(restored.sourceSpec, "source:first");
    assert.equal(restored.packageVersion, "1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
