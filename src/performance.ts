import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type ScanCacheStatus = "hit" | "miss" | "in_flight";

export type ToolPerformanceSample = {
  durationMs: number;
  failed: boolean;
  scan: {
    calls: number;
    cacheHits: number;
    cacheMisses: number;
    inFlightHits: number;
    totalMs: number;
    maxMs: number;
  };
  searchRg: {
    runs: number;
    totalMs: number;
    maxMs: number;
  };
};

type PerformanceCollector = Omit<ToolPerformanceSample, "durationMs" | "failed">;

const collectors = new AsyncLocalStorage<PerformanceCollector>();

function roundMs(value: number): number {
  return Number(value.toFixed(2));
}

function createCollector(): PerformanceCollector {
  return {
    scan: {
      calls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      inFlightHits: 0,
      totalMs: 0,
      maxMs: 0,
    },
    searchRg: {
      runs: 0,
      totalMs: 0,
      maxMs: 0,
    },
  };
}

export function recordScanPerformance(
  status: ScanCacheStatus,
  durationMs: number,
): void {
  const collector = collectors.getStore();
  if (!collector) return;

  collector.scan.calls += 1;
  collector.scan.totalMs += durationMs;
  collector.scan.maxMs = Math.max(collector.scan.maxMs, durationMs);

  if (status === "hit") collector.scan.cacheHits += 1;
  if (status === "miss") collector.scan.cacheMisses += 1;
  if (status === "in_flight") collector.scan.inFlightHits += 1;
}

export function recordSearchRgPerformance(durationMs: number): void {
  const collector = collectors.getStore();
  if (!collector) return;

  collector.searchRg.runs += 1;
  collector.searchRg.totalMs += durationMs;
  collector.searchRg.maxMs = Math.max(collector.searchRg.maxMs, durationMs);
}

export async function collectToolPerformance<T>(
  action: () => Promise<T>,
): Promise<{
  value?: T;
  error?: unknown;
  sample: ToolPerformanceSample;
}> {
  const collector = createCollector();
  const startedAt = performance.now();
  let value: T | undefined;
  let error: unknown;

  await collectors.run(collector, async () => {
    try {
      value = await action();
    } catch (caught) {
      error = caught;
    }
  });

  const durationMs = performance.now() - startedAt;

  return {
    value,
    error,
    sample: {
      durationMs: roundMs(durationMs),
      failed: error !== undefined,
      scan: {
        ...collector.scan,
        totalMs: roundMs(collector.scan.totalMs),
        maxMs: roundMs(collector.scan.maxMs),
      },
      searchRg: {
        ...collector.searchRg,
        totalMs: roundMs(collector.searchRg.totalMs),
        maxMs: roundMs(collector.searchRg.maxMs),
      },
    },
  };
}
