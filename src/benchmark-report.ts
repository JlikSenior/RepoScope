import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseBenchmarkJsonl, summarizeBenchmark } from "./benchmark";

async function main(): Promise<void> {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Usage: npm run benchmark:report -- <benchmark.jsonl>");
  }

  const fullPath = resolve(inputPath);
  const content = await readFile(fullPath, "utf8");
  const runs = parseBenchmarkJsonl(content);
  const summary = summarizeBenchmark(runs);

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main();
