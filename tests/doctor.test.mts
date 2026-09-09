import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import {
  buildDoctorReport,
  type DoctorCheck,
  type DoctorReport,
} from "../src/doctor.mjs";
import { installAgentIntegration } from "../src/integration-setup.mjs";
import { installLocalRuntime } from "../src/runtime-install.mjs";

const execFileAsync = promisify(execFile);

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "reposcope-doctor-"));
  const project = join(root, "project");
  const runtimeRoot = join(root, "runtime");
  const stateRoot = join(root, "state");
  await mkdir(project, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: project });
  await writeFile(
    join(project, ".reposcope.json"),
    JSON.stringify({ commands: { check: ["npm", "run", "check"] } }),
    "utf8",
  );

  const env = {
    ...process.env,
    REPOSCOPE_RUNTIME_DIR: runtimeRoot,
    REPOSCOPE_STATE_DIR: stateRoot,
  };
  const runtime = await installLocalRuntime("doctor-fixture", {
    env,
    installer: async ({ stagingDir }) => {
      const packageDir = join(stagingDir, "node_modules", "reposcope");
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "reposcope", version: "9.9.9" }),
        "utf8",
      );
      await writeFile(join(packageDir, "dist", "bin.mjs"), "console.log('fixture');\n", "utf8");
    },
  });

  return { root, project, runtimeRoot, stateRoot, env, runtime };
}

function check(report: DoctorReport, id: string): DoctorCheck {
  const value = report.checks.find((item) => item.id === id);
  assert(value, `Missing doctor check: ${id}`);
  return value;
}

test("doctor validates Cursor and Codex adapters without modifying project files", async () => {
  const fixture = await makeFixture();
  try {
    await installAgentIntegration("cursor", {
      projectRoot: fixture.project,
      packageRoot: process.cwd(),
      runtimeEntryPath: fixture.runtime.entryPath,
    });
    await installAgentIntegration("codex", {
      projectRoot: fixture.project,
      runtimeEntryPath: fixture.runtime.entryPath,
    });

    const paths = [
      join(fixture.project, ".cursor", "mcp.json"),
      join(fixture.project, ".codex", "config.toml"),
      join(fixture.project, "AGENTS.md"),
    ];
    const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));

    const cursor = await buildDoctorReport(fixture.project, {
      agent: "cursor",
      env: fixture.env,
    });
    const codex = await buildDoctorReport(fixture.project, {
      agent: "codex",
      env: fixture.env,
    });

    assert.notEqual(cursor.status, "error");
    assert.notEqual(codex.status, "error");
    assert.equal(check(cursor, "runtime").status, "ok");
    assert.equal(check(cursor, "git").status, "ok");
    assert.equal(check(cursor, "repo-config").status, "ok");
    assert.equal(check(cursor, "cursor-mcp").status, "ok");
    assert.equal(check(codex, "codex-mcp").status, "ok");
    assert.equal(check(codex, "codex-guidance").status, "ok");

    const after = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    assert.deepEqual(after, before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("doctor reports stale Cursor binding and invalid repository config as errors", async () => {
  const fixture = await makeFixture();
  try {
    await installAgentIntegration("cursor", {
      projectRoot: fixture.project,
      packageRoot: process.cwd(),
      runtimeEntryPath: fixture.runtime.entryPath,
    });
    const mcpPath = join(fixture.project, ".cursor", "mcp.json");
    const config = JSON.parse(await readFile(mcpPath, "utf8"));
    config.mcpServers.reposcope.args[0] = join(fixture.root, "wrong-runtime", "bin.mjs");
    await writeFile(mcpPath, JSON.stringify(config, null, 2), "utf8");
    await writeFile(join(fixture.project, ".reposcope.json"), "{broken", "utf8");

    const report = await buildDoctorReport(fixture.project, {
      agent: "cursor",
      env: fixture.env,
    });

    assert.equal(report.status, "error");
    assert.equal(check(report, "cursor-mcp").status, "error");
    assert.equal(check(report, "repo-config").status, "error");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("doctor reports a missing fixed runtime as an error", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-doctor-no-runtime-"));
  const project = join(root, "project");
  try {
    await mkdir(project, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: project });
    const report = await buildDoctorReport(project, {
      env: {
        ...process.env,
        REPOSCOPE_RUNTIME_DIR: join(root, "missing-runtime"),
        REPOSCOPE_STATE_DIR: join(root, "state"),
      },
    });
    assert.equal(report.status, "error");
    assert.equal(check(report, "runtime").status, "error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
