import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("../", import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), "reposcope-runtime-smoke-"));
const packDir = join(tempRoot, "pack");
const runtimeDir = join(tempRoot, "runtime");
const projectDir = join(tempRoot, "project");
const env = {
  ...process.env,
  REPOSCOPE_RUNTIME_DIR: runtimeDir,
};

function run(executable, args, options = {}) {
  return execFileSync(executable, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

try {
  await import("node:fs/promises").then(({ mkdir }) =>
    Promise.all([
      mkdir(packDir, { recursive: true }),
      mkdir(projectDir, { recursive: true }),
    ]),
  );

  run("npm", ["pack", "--silent", "--pack-destination", packDir]);
  const tarballs = (await readdir(packDir)).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  const tarballPath = join(packDir, tarballs[0]);

  const installOutput = run("node", [
    join(repoRoot, "dist", "bin.mjs"),
    "runtime",
    "install",
    "--source",
    tarballPath,
  ]);
  const installed = JSON.parse(installOutput);
  assert.equal(installed.installed, true);
  assert.equal(installed.runtimeRoot, runtimeDir);
  assert.match(
    installed.entryPath,
    /current[\\/]node_modules[\\/]reposcope[\\/]dist[\\/]bin\.mjs$/,
  );

  const help = run("node", [installed.entryPath, "help"]);
  assert.match(help, /RepoScope/);
  assert.doesNotMatch(help, /spawn rg ENOENT/);

  const integrationModule = await import(
    pathToFileURL(join(repoRoot, "dist", "integration-setup.mjs")).href
  );
  const result = await integrationModule.installAgentIntegration("codex", {
    projectRoot: projectDir,
    runtimeEntryPath: installed.entryPath,
  });
  assert.equal(result.launchSpec.command, "node");
  assert.equal(result.launchSpec.args[0], installed.entryPath);

  const codexConfig = await readFile(join(projectDir, ".codex", "config.toml"), "utf8");
  assert.match(codexConfig, /command = "node"/);
  assert(codexConfig.includes(JSON.stringify(installed.entryPath)));
  assert.doesNotMatch(codexConfig, /command = "npx"/);

  console.log("Local runtime package smoke check passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
