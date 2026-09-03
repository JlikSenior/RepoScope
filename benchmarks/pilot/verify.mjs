import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const [, , taskId, targetArg] = process.argv;

if (!taskId || !targetArg) {
  console.error("Usage: node benchmarks/pilot/verify.mjs <taskId> <target-repo>");
  process.exit(2);
}

const target = resolve(targetArg);

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: target,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

async function runTargetTs(source) {
  const file = join(target, `.reposcope-pilot-verify-${process.pid}.mts`);
  await writeFile(file, source);

  try {
    await run("npx", ["--no-install", "tsx", basename(file)]);
  } finally {
    await rm(file, { force: true });
  }
}

async function verifySessionStartScaling() {
  const source = await readFile(join(target, "src/sessions.ts"), "utf8");

  assert(!/\breadFile\s*\(/.test(source), "sessions.ts still reads repository file contents");
  assert(!/getEncoding|\.encode\s*\(/.test(source), "sessions.ts still tokenizes whole-file contents");
}

async function verifyContextReadDedup() {
  await runTargetTs(`
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext, readRepo } from "./src/core.ts";
import { startSession } from "./src/sessions.ts";

const fixture = await mkdtemp(join(tmpdir(), "reposcope-pilot-dedup-"));
try {
  await writeFile(join(fixture, "payment.ts"), "export const payment = true;\\n");
  const session = await startSession({ targetPath: fixture, task: "inspect payment", budgetTokens: 1000 });
  const context = await buildContext({
    targetPath: fixture,
    task: "inspect payment",
    searchTerms: ["payment"],
    fileHints: ["payment.ts"],
    budgetTokens: 500,
    sessionId: session.sessionId,
  });
  assert.equal(context.selectedFiles.length, 1);
  const used = context.session?.usedTokens;
  const read = await readRepo({
    targetPath: fixture,
    files: ["payment.ts"],
    budgetTokens: 500,
    sessionId: session.sessionId,
  });
  assert.equal(read.files.length, 0);
  assert.equal(read.skippedFiles[0]?.reason, "already_read");
  assert.equal(read.session?.usedTokens, used);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
`);
}

async function verifyBoundedSearchResults() {
  await runTargetTs(`
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRepo } from "./src/core.ts";

const fixture = await mkdtemp(join(tmpdir(), "reposcope-pilot-search-"));
try {
  for (let i = 0; i < 30; i += 1) {
    await writeFile(join(fixture, `file-\${i}.ts`), `export const common\${i} = "common-term";\\n`);
  }
  const result = await searchRepo({ targetPath: fixture, searchTerms: ["common-term"], limit: 5 });
  assert(result.results.length <= 5, `expected <= 5 results, got \${result.results.length}`);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
`);
}

async function verifyMcpTypecheckCoverage() {
  const { stdout } = await run("npx", ["--no-install", "tsc", "--showConfig"]);
  const config = JSON.parse(stdout);
  const files = Array.isArray(config.files) ? config.files : [];
  assert(
    files.some((file) => String(file).replaceAll("\\\\", "/").endsWith("/src/mcp.mts") || String(file).replaceAll("\\\\", "/") === "./src/mcp.mts"),
    "TypeScript config does not include src/mcp.mts",
  );
}

async function verifySearchAiReadableBoundary() {
  await runTargetTs(`
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRepo } from "./src/core.ts";

const fixture = await mkdtemp(join(tmpdir(), "reposcope-pilot-boundary-"));
try {
  await writeFile(join(fixture, "valid.ts"), "export const ok = 'needle-boundary';\\n");
  await writeFile(join(fixture, "large.txt"), "needle-boundary\\n" + "x".repeat(1024 * 1024 + 4096));
  const result = await searchRepo({ targetPath: fixture, searchTerms: ["needle-boundary"], limit: 20 });
  const paths = result.results.map((item) => item.path);
  assert(paths.includes("valid.ts"), "expected valid.ts in search results");
  assert(!paths.includes("large.txt"), "search exposed a file rejected by the scanner size boundary");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
`);
}

const verifiers = {
  "session-start-scaling": verifySessionStartScaling,
  "context-read-dedup": verifyContextReadDedup,
  "bounded-search-results": verifyBoundedSearchResults,
  "mcp-typecheck-coverage": verifyMcpTypecheckCoverage,
  "search-ai-readable-boundary": verifySearchAiReadableBoundary,
};

const verifier = verifiers[taskId];

if (!verifier) {
  console.error(`Unknown pilot task: ${taskId}`);
  process.exit(2);
}

try {
  await verifier();
  console.log(`PASS ${taskId}`);
} catch (error) {
  console.error(`FAIL ${taskId}`);
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
