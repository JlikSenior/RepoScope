import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { installLocalRuntime } from "../src/runtime-install.mjs";
import {
  checkRuntimeUpdate,
  readInstalledRuntimeBuildInfo,
  resolveSourceRevision,
  updateLocalRuntime,
} from "../src/runtime-update.mjs";

const REV_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REV_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function fakeInstall(
  stagingDir: string,
  version: string,
  revision?: string | null,
): Promise<void> {
  const packageRoot = join(stagingDir, "node_modules", "reposcope");
  const dist = join(packageRoot, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "reposcope", version }),
    "utf8",
  );
  await writeFile(join(dist, "bin.mjs"), "console.log('runtime');\n", "utf8");
  if (revision !== undefined) {
    await writeFile(
      join(dist, "build-info.json"),
      JSON.stringify({
        schemaVersion: 1,
        packageVersion: version,
        revision,
      }),
      "utf8",
    );
  }
}

test("Runtime update check distinguishes current and update-available revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-update-"));
  const env = { REPOSCOPE_RUNTIME_DIR: join(root, "runtime") };

  try {
    const runtime = await installLocalRuntime("github:example/reposcope#main", {
      env,
      installer: async ({ stagingDir }) => fakeInstall(stagingDir, "0.1.0", REV_A),
    });
    const build = await readInstalledRuntimeBuildInfo(runtime);
    assert.equal(build.revision, REV_A);

    const current = await checkRuntimeUpdate({
      runtime: { env },
      resolver: async () => ({ revision: REV_A }),
    });
    assert.equal(current.state, "current");
    assert.equal(current.installedRevision, REV_A);
    assert.equal(current.latestRevision, REV_A);

    const update = await checkRuntimeUpdate({
      runtime: { env },
      resolver: async () => ({ revision: REV_B }),
    });
    assert.equal(update.state, "update_available");
    assert.equal(update.latestRevision, REV_B);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pre-M3 Runtime is reported with unknown installed revision instead of guessed identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-old-"));
  const env = { REPOSCOPE_RUNTIME_DIR: join(root, "runtime") };

  try {
    await installLocalRuntime("github:example/reposcope#main", {
      env,
      installer: async ({ stagingDir }) => fakeInstall(stagingDir, "0.1.0"),
    });

    const result = await checkRuntimeUpdate({
      runtime: { env },
      resolver: async () => ({ revision: REV_B }),
    });
    assert.equal(result.state, "unknown_installed_revision");
    assert.equal(result.installedRevision, null);
    assert.equal(result.latestRevision, REV_B);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uncheckable Runtime source is explicit and does not claim current status", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-uncheckable-"));
  const env = { REPOSCOPE_RUNTIME_DIR: join(root, "runtime") };

  try {
    await installLocalRuntime("local:custom-source", {
      env,
      installer: async ({ stagingDir }) => fakeInstall(stagingDir, "0.1.0", REV_A),
    });

    const result = await checkRuntimeUpdate({
      runtime: { env },
      resolver: async () => ({ reason: "offline or unsupported source" }),
    });
    assert.equal(result.state, "source_uncheckable");
    assert.match(result.message, /offline or unsupported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Runtime update forcibly reinstalls the existing source and records the new build identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-runtime-force-update-"));
  const env = { REPOSCOPE_RUNTIME_DIR: join(root, "runtime") };

  try {
    await installLocalRuntime("github:example/reposcope#main", {
      env,
      installer: async ({ stagingDir }) => fakeInstall(stagingDir, "0.1.0", REV_A),
    });

    const updated = await updateLocalRuntime({
      env,
      installer: async ({ stagingDir, sourceSpec }) => {
        assert.equal(sourceSpec, "github:example/reposcope#main");
        await fakeInstall(stagingDir, "0.1.1", REV_B);
      },
    });

    assert.equal(updated.runtime.sourceSpec, "github:example/reposcope#main");
    assert.equal(updated.runtime.packageVersion, "0.1.1");
    assert.equal(updated.build.packageVersion, "0.1.1");
    assert.equal(updated.build.revision, REV_B);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("immutable GitHub commit source resolves without a network request", async () => {
  const result = await resolveSourceRevision(`github:example/reposcope#${REV_A}`);
  assert.equal(result.revision, REV_A);
});
