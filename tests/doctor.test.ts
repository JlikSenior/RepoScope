import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { buildCursorMcpSnippet } from "../src/cursor-setup.mjs";
import { buildDoctorReport } from "../src/doctor.js";

const execFileAsync = promisify(execFile);

async function createProject(prefix: string): Promise<{
  root: string;
  stateRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const stateRoot = await mkdtemp(join(tmpdir(), `${prefix}state-`));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  return { root, stateRoot };
}

async function installFixtureIntegration(root: string): Promise<void> {
  await mkdir(join(root, ".cursor", "rules"), { recursive: true });
  await mkdir(join(root, ".cursor", "skills", "reposcope"), { recursive: true });
  await mkdir(join(root, ".cursor", "skills", "reposcope-benchmark"), {
    recursive: true,
  });
  await writeFile(
    join(root, ".cursor", "mcp.json"),
    `${JSON.stringify(buildCursorMcpSnippet(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(root, ".cursor", "rules", "reposcope.mdc"), "rule\n");
  await writeFile(
    join(root, ".cursor", "skills", "reposcope", "SKILL.md"),
    "skill\n",
  );
  await writeFile(
    join(root, ".cursor", "skills", "reposcope-benchmark", "SKILL.md"),
    "benchmark\n",
  );
}

test("doctor reports a fully configured project as healthy", async () => {
  const { root, stateRoot } = await createProject("reposcope-doctor-ok-");

  try {
    await writeFile(
      join(root, ".reposcope.json"),
      JSON.stringify({ commands: { test: ["npm", "test"] } }),
      "utf8",
    );
    await installFixtureIntegration(root);

    const report = await buildDoctorReport(root, {
      env: { REPOSCOPE_STATE_DIR: stateRoot },
    });

    assert.equal(report.ok, true);
    assert.equal(report.status, "ok");
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
    assert(report.checks.some((item) => item.id === "ripgrep" && item.status === "ok"));
    assert(report.checks.some((item) => item.id === "cursor-mcp" && item.status === "ok"));
    assert(report.checks.some((item) => item.id === "command-policy" && item.status === "ok"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("doctor treats optional integration gaps as warnings without changing the project", async () => {
  const { root, stateRoot } = await createProject("reposcope-doctor-warn-");

  try {
    const before = await readdir(root);
    const report = await buildDoctorReport(root, {
      env: { REPOSCOPE_STATE_DIR: stateRoot },
    });
    const after = await readdir(root);

    assert.equal(report.ok, true);
    assert.equal(report.status, "warning");
    assert.equal(report.summary.errors, 0);
    assert(report.summary.warnings >= 3);
    assert.deepEqual(after, before);
    assert(
      report.checks.some(
        (item) => item.id === "command-policy" && item.status === "warning",
      ),
    );
    assert(
      report.checks.some(
        (item) => item.id === "cursor-mcp" && item.status === "warning",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("doctor reports an invalid command policy as an error", async () => {
  const { root, stateRoot } = await createProject("reposcope-doctor-error-");

  try {
    await writeFile(
      join(root, ".reposcope.json"),
      JSON.stringify({ commands: { unsafe: ["../script.sh"] } }),
      "utf8",
    );

    const report = await buildDoctorReport(root, {
      env: { REPOSCOPE_STATE_DIR: stateRoot },
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "error");
    assert(report.summary.errors >= 1);
    const policy = report.checks.find((item) => item.id === "command-policy");
    assert.equal(policy?.status, "error");
    assert.match(String(policy?.details?.error), /Unsafe executable/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
