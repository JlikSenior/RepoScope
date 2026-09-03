import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseBenchmarkJsonl,
  summarizeBenchmark,
  type BenchmarkRun,
} from "../src/benchmark";

function run(overrides: Partial<BenchmarkRun>): BenchmarkRun {
  return {
    schemaVersion: 1,
    runId: "run-default",
    taskId: "task-1",
    mode: "baseline",
    agent: "codex",
    repository: "example/repo",
    commit: "abc123",
    trial: "1",
    outcome: "success",
    verification: "passed",
    metrics: {},
    ...overrides,
  };
}

test("benchmark summary compares successful paired runs", () => {
  const runs: BenchmarkRun[] = [
    run({
      runId: "baseline-1",
      mode: "baseline",
      metrics: {
        sourceTokens: 1000,
        modelInputTokens: 2000,
        filesRead: 10,
        durationMs: 10000,
      },
    }),
    run({
      runId: "reposcope-1",
      mode: "reposcope",
      metrics: {
        sourceTokens: 250,
        modelInputTokens: 800,
        filesRead: 4,
        durationMs: 9000,
        mcpTokens: 350,
      },
    }),
  ];

  const summary = summarizeBenchmark(runs);

  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.uniqueTasks, 1);
  assert.equal(summary.modes.baseline.verifiedSuccessRate, 100);
  assert.equal(summary.modes.reposcope.verifiedSuccessRate, 100);
  assert.equal(summary.pairing.completePairs, 1);
  assert.equal(summary.pairing.verification.bothPassed, 1);
  assert.equal(
    summary.pairing.reductions.sourceTokens?.medianReductionPercent,
    75,
  );
  assert.equal(
    summary.pairing.reductions.modelInputTokens?.medianReductionPercent,
    60,
  );
  assert.equal(
    summary.pairing.reductions.filesRead?.medianReductionPercent,
    60,
  );
});

test("benchmark keeps reported success separate from verification", () => {
  const summary = summarizeBenchmark([
    run({
      runId: "baseline-2",
      mode: "baseline",
      outcome: "success",
      verification: "passed",
    }),
    run({
      runId: "reposcope-2",
      mode: "reposcope",
      outcome: "success",
      verification: "failed",
    }),
  ]);

  assert.equal(summary.modes.reposcope.reportedSuccessRate, 100);
  assert.equal(summary.modes.reposcope.verifiedSuccessRate, 0);
  assert.equal(summary.pairing.verification.baselineOnlyPassed, 1);
});

test("benchmark parser rejects duplicate run ids", () => {
  const record = JSON.stringify(run({ runId: "duplicate" }));

  assert.throws(
    () => parseBenchmarkJsonl(`${record}\n${record}\n`),
    /duplicate runId/,
  );
});

test("benchmark marks repeated task arms as ambiguous instead of averaging them", () => {
  const summary = summarizeBenchmark([
    run({ runId: "baseline-a", mode: "baseline" }),
    run({ runId: "baseline-b", mode: "baseline" }),
    run({ runId: "reposcope-a", mode: "reposcope" }),
  ]);

  assert.equal(summary.pairing.completePairs, 0);
  assert.equal(summary.pairing.ambiguousKeys, 1);
});

test("benchmark does not pair runs from different commits or trials", () => {
  const summary = summarizeBenchmark([
    run({ runId: "baseline-commit", mode: "baseline", commit: "abc123" }),
    run({ runId: "reposcope-commit", mode: "reposcope", commit: "def456" }),
    run({ runId: "baseline-trial", mode: "baseline", taskId: "task-2", trial: "1" }),
    run({ runId: "reposcope-trial", mode: "reposcope", taskId: "task-2", trial: "2" }),
  ]);

  assert.equal(summary.pairing.completePairs, 0);
  assert.equal(summary.pairing.incompleteKeys, 4);
});
