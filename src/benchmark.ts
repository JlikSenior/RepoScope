export type BenchmarkMode = "baseline" | "reposcope";
export type BenchmarkOutcome = "success" | "failed" | "abandoned";
export type BenchmarkVerification = "passed" | "failed" | "not_run";

export type BenchmarkMetrics = {
  durationMs?: number;
  filesRead?: number;
  sourceTokens?: number;
  modelInputTokens?: number;
  modelOutputTokens?: number;
  toolCalls?: number;
  mcpTokens?: number;
};

export type BenchmarkRun = {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  mode: BenchmarkMode;
  agent: string;
  repository: string;
  commit?: string;
  trial?: string;
  outcome: BenchmarkOutcome;
  verification: BenchmarkVerification;
  metrics: BenchmarkMetrics;
  note?: string;
};

type NumericMetricName =
  | "durationMs"
  | "filesRead"
  | "sourceTokens"
  | "modelInputTokens"
  | "modelOutputTokens"
  | "toolCalls"
  | "mcpTokens";

export type MetricSummary = {
  samples: number;
  average: number;
  median: number;
};

export type ModeBenchmarkSummary = {
  runs: number;
  reportedSuccessRate: number;
  verifiedSuccessRate: number;
  metrics: Partial<Record<NumericMetricName, MetricSummary>>;
};

export type PairedMetricSummary = {
  pairs: number;
  averageReductionPercent: number;
  medianReductionPercent: number;
};

export type BenchmarkSummary = {
  totalRuns: number;
  uniqueTasks: number;
  modes: Record<BenchmarkMode, ModeBenchmarkSummary>;
  pairing: {
    completePairs: number;
    incompleteKeys: number;
    ambiguousKeys: number;
    verification: {
      bothPassed: number;
      baselineOnlyPassed: number;
      reposcopeOnlyPassed: number;
      neitherPassed: number;
    };
    reductions: Partial<Record<NumericMetricName, PairedMetricSummary>>;
  };
};

const NUMERIC_METRICS: NumericMetricName[] = [
  "durationMs",
  "filesRead",
  "sourceTokens",
  "modelInputTokens",
  "modelOutputTokens",
  "toolCalls",
  "mcpTokens",
];

function round(value: number): number {
  return Number(value.toFixed(2));
}

function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate median of an empty list");
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeValues(values: number[]): MetricSummary | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return {
    samples: values.length,
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    median: round(median(values)),
  };
}

function requireString(
  object: Record<string, unknown>,
  key: string,
  lineNumber: number,
): string {
  const value = object[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Benchmark line ${lineNumber}: ${key} must be a non-empty string`);
  }

  return value;
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
  lineNumber: number,
): string | undefined {
  const value = object[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Benchmark line ${lineNumber}: ${key} must be a string`);
  }

  return value;
}

function parseMetrics(value: unknown, lineNumber: number): BenchmarkMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Benchmark line ${lineNumber}: metrics must be an object`);
  }

  const input = value as Record<string, unknown>;
  const metrics: BenchmarkMetrics = {};

  for (const metric of NUMERIC_METRICS) {
    const metricValue = input[metric];

    if (metricValue === undefined) {
      continue;
    }

    if (
      typeof metricValue !== "number" ||
      !Number.isFinite(metricValue) ||
      metricValue < 0
    ) {
      throw new Error(
        `Benchmark line ${lineNumber}: metrics.${metric} must be a non-negative finite number`,
      );
    }

    metrics[metric] = metricValue;
  }

  return metrics;
}

function parseRun(value: unknown, lineNumber: number): BenchmarkRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Benchmark line ${lineNumber}: record must be an object`);
  }

  const input = value as Record<string, unknown>;

  if (input.schemaVersion !== 1) {
    throw new Error(`Benchmark line ${lineNumber}: schemaVersion must be 1`);
  }

  const mode = input.mode;
  if (mode !== "baseline" && mode !== "reposcope") {
    throw new Error(`Benchmark line ${lineNumber}: invalid mode`);
  }

  const outcome = input.outcome;
  if (outcome !== "success" && outcome !== "failed" && outcome !== "abandoned") {
    throw new Error(`Benchmark line ${lineNumber}: invalid outcome`);
  }

  const verification = input.verification;
  if (
    verification !== "passed" &&
    verification !== "failed" &&
    verification !== "not_run"
  ) {
    throw new Error(`Benchmark line ${lineNumber}: invalid verification`);
  }

  return {
    schemaVersion: 1,
    runId: requireString(input, "runId", lineNumber),
    taskId: requireString(input, "taskId", lineNumber),
    mode,
    agent: requireString(input, "agent", lineNumber),
    repository: requireString(input, "repository", lineNumber),
    commit: optionalString(input, "commit", lineNumber),
    trial: optionalString(input, "trial", lineNumber),
    outcome,
    verification,
    metrics: parseMetrics(input.metrics, lineNumber),
    note: optionalString(input, "note", lineNumber),
  };
}

export function parseBenchmarkJsonl(content: string): BenchmarkRun[] {
  const lines = content.split("\n");
  const runs: BenchmarkRun[] = [];
  const runIds = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Benchmark line ${index + 1}: invalid JSON`);
    }

    const run = parseRun(parsed, index + 1);

    if (runIds.has(run.runId)) {
      throw new Error(`Benchmark line ${index + 1}: duplicate runId ${run.runId}`);
    }

    runIds.add(run.runId);
    runs.push(run);
  }

  return runs;
}

function summarizeMode(runs: BenchmarkRun[]): ModeBenchmarkSummary {
  const metrics: Partial<Record<NumericMetricName, MetricSummary>> = {};

  for (const metric of NUMERIC_METRICS) {
    const values = runs
      .map((run) => run.metrics[metric])
      .filter((value): value is number => value !== undefined);
    const summary = summarizeValues(values);

    if (summary) {
      metrics[metric] = summary;
    }
  }

  const reportedSuccesses = runs.filter((run) => run.outcome === "success").length;
  const verifiedSuccesses = runs.filter(
    (run) => run.verification === "passed",
  ).length;

  return {
    runs: runs.length,
    reportedSuccessRate:
      runs.length === 0 ? 0 : round((reportedSuccesses / runs.length) * 100),
    verifiedSuccessRate:
      runs.length === 0 ? 0 : round((verifiedSuccesses / runs.length) * 100),
    metrics,
  };
}

function pairKey(run: BenchmarkRun): string {
  return [
    run.repository,
    run.commit ?? "",
    run.taskId,
    run.agent,
    run.trial ?? "",
  ].join("\u0000");
}

function reductionPercent(baseline: number, reposcope: number): number | undefined {
  if (baseline <= 0) {
    return undefined;
  }

  return ((baseline - reposcope) / baseline) * 100;
}

export function summarizeBenchmark(runs: BenchmarkRun[]): BenchmarkSummary {
  const baselineRuns = runs.filter((run) => run.mode === "baseline");
  const reposcopeRuns = runs.filter((run) => run.mode === "reposcope");
  const grouped = new Map<string, { baseline: BenchmarkRun[]; reposcope: BenchmarkRun[] }>();

  for (const run of runs) {
    const key = pairKey(run);
    const group = grouped.get(key) ?? { baseline: [], reposcope: [] };
    group[run.mode].push(run);
    grouped.set(key, group);
  }

  let completePairs = 0;
  let incompleteKeys = 0;
  let ambiguousKeys = 0;
  let bothPassed = 0;
  let baselineOnlyPassed = 0;
  let reposcopeOnlyPassed = 0;
  let neitherPassed = 0;

  const reductions: Partial<Record<NumericMetricName, number[]>> = {};

  for (const group of grouped.values()) {
    if (group.baseline.length === 0 || group.reposcope.length === 0) {
      incompleteKeys += 1;
      continue;
    }

    if (group.baseline.length !== 1 || group.reposcope.length !== 1) {
      ambiguousKeys += 1;
      continue;
    }

    completePairs += 1;
    const baseline = group.baseline[0];
    const reposcope = group.reposcope[0];
    const baselinePassed = baseline.verification === "passed";
    const reposcopePassed = reposcope.verification === "passed";

    if (baselinePassed && reposcopePassed) {
      bothPassed += 1;
    } else if (baselinePassed) {
      baselineOnlyPassed += 1;
    } else if (reposcopePassed) {
      reposcopeOnlyPassed += 1;
    } else {
      neitherPassed += 1;
    }

    for (const metric of NUMERIC_METRICS) {
      const baselineValue = baseline.metrics[metric];
      const reposcopeValue = reposcope.metrics[metric];

      if (baselineValue === undefined || reposcopeValue === undefined) {
        continue;
      }

      const reduction = reductionPercent(baselineValue, reposcopeValue);

      if (reduction === undefined) {
        continue;
      }

      const values = reductions[metric] ?? [];
      values.push(reduction);
      reductions[metric] = values;
    }
  }

  const summarizedReductions: Partial<
    Record<NumericMetricName, PairedMetricSummary>
  > = {};

  for (const metric of NUMERIC_METRICS) {
    const values = reductions[metric];

    if (!values || values.length === 0) {
      continue;
    }

    summarizedReductions[metric] = {
      pairs: values.length,
      averageReductionPercent: round(
        values.reduce((sum, value) => sum + value, 0) / values.length,
      ),
      medianReductionPercent: round(median(values)),
    };
  }

  return {
    totalRuns: runs.length,
    uniqueTasks: new Set(runs.map((run) => `${run.repository}\u0000${run.taskId}`)).size,
    modes: {
      baseline: summarizeMode(baselineRuns),
      reposcope: summarizeMode(reposcopeRuns),
    },
    pairing: {
      completePairs,
      incompleteKeys,
      ambiguousKeys,
      verification: {
        bothPassed,
        baselineOnlyPassed,
        reposcopeOnlyPassed,
        neitherPassed,
      },
      reductions: summarizedReductions,
    },
  };
}
