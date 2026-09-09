import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

type CliFailure = Error & {
  stdout?: string | Buffer;
};

type DoctorCliReport = {
  status: "ok" | "warning" | "error";
  checks: Array<{ id: string; status: "ok" | "warning" | "error" }>;
};

test("doctor CLI emits JSON and exits non-zero when the fixed runtime is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-doctor-cli-"));
  const project = join(root, "project");
  const runtimeRoot = join(root, "runtime");
  const stateRoot = join(root, "state");

  try {
    await mkdir(project, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: project });

    let failure: CliFailure | undefined;
    try {
      await execFileAsync(
        process.execPath,
        ["--import", "tsx", "src/bin.mts", "doctor", "--project", project],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            REPOSCOPE_RUNTIME_DIR: runtimeRoot,
            REPOSCOPE_STATE_DIR: stateRoot,
          },
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch (caught) {
      failure = caught as CliFailure;
    }

    assert(failure);
    const stdout = String(failure.stdout ?? "");
    const report = JSON.parse(stdout) as DoctorCliReport;
    assert.equal(report.status, "error");
    assert.equal(
      report.checks.find((check) => check.id === "runtime")?.status,
      "error",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup CLI returns bounded cleanup results", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-cleanup-cli-"));
  const project = join(root, "project");

  try {
    await mkdir(project, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: project });
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/bin.mts", "cleanup", "--project", project],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REPOSCOPE_RUNTIME_DIR: join(root, "runtime"),
          REPOSCOPE_STATE_DIR: join(root, "state"),
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const result = JSON.parse(stdout) as {
      schemaVersion: number;
      project: { removedActiveSessions: number };
      runtime: { removedInstallDirs: number };
    };
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.project.removedActiveSessions, 0);
    assert.equal(result.runtime.removedInstallDirs, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
