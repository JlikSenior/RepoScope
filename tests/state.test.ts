import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { ensureProjectState, getProjectStatePaths } from "../src/state";

const fixtures: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  fixtures.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("same-named repositories get different project state directories", async () => {
  const root = await tempRoot("reposcope-state-");
  const repoA = join(root, "owner-a", "app");
  const repoB = join(root, "owner-b", "app");
  const stateRoot = join(root, "state");

  await mkdir(repoA, { recursive: true });
  await mkdir(repoB, { recursive: true });

  const options = {
    env: { REPOSCOPE_STATE_DIR: stateRoot },
    homeDir: root,
    platformName: "linux" as const,
  };
  const a = await getProjectStatePaths(repoA, options);
  const b = await getProjectStatePaths(repoB, options);

  assert.notEqual(a.projectId, b.projectId);
  assert.notEqual(a.projectDir, b.projectDir);
  assert.equal(a.stateRoot, stateRoot);
  assert.equal(b.stateRoot, stateRoot);
});

test("symlinked paths resolve to the same project identity", async () => {
  const root = await tempRoot("reposcope-state-link-");
  const repo = join(root, "real-repo");
  const alias = join(root, "repo-link");
  const stateRoot = join(root, "state");

  await mkdir(repo, { recursive: true });
  await symlink(repo, alias, "dir");

  const options = {
    env: { REPOSCOPE_STATE_DIR: stateRoot },
    homeDir: root,
    platformName: "linux" as const,
  };
  const real = await getProjectStatePaths(repo, options);
  const linked = await getProjectStatePaths(alias, options);

  assert.equal(real.projectId, linked.projectId);
  assert.equal(real.projectDir, linked.projectDir);
});

test("ensureProjectState creates metadata outside the target repository", async () => {
  const root = await tempRoot("reposcope-state-meta-");
  const repo = join(root, "workspace", "project");
  const stateRoot = join(root, "isolated-state");

  await mkdir(repo, { recursive: true });

  const state = await ensureProjectState(repo, {
    env: { REPOSCOPE_STATE_DIR: stateRoot },
    homeDir: root,
    platformName: "linux",
  });
  const metadata = JSON.parse(await readFile(state.metadataPath, "utf8")) as {
    schemaVersion: number;
    projectId: string;
    name: string;
    targetPath: string;
  };

  assert.equal(state.stateRoot, stateRoot);
  assert(state.projectDir.startsWith(stateRoot));
  assert(!state.projectDir.startsWith(repo));
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.projectId, state.projectId);
  assert.equal(metadata.name, "project");
  assert.equal(metadata.targetPath, repo);
});
