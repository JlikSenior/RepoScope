import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { installAgentIntegration } from "../src/integration-setup.mjs";

test("Cursor and Codex project adapters launch one shared installed runtime without npx", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-local-runtime-adapters-"));
  const project = join(root, "workspace", "project");
  const runtimeEntryPath = join(
    root,
    "runtime",
    "current",
    "node_modules",
    "reposcope",
    "dist",
    "bin.mjs",
  );

  try {
    await mkdir(project, { recursive: true });
    const canonicalProject = await realpath(project);

    const cursor = await installAgentIntegration("cursor", {
      projectRoot: project,
      packageRoot: process.cwd(),
      runtimeEntryPath,
    });
    const codex = await installAgentIntegration("codex", {
      projectRoot: project,
      runtimeEntryPath,
    });

    const expectedArgs = [
      runtimeEntryPath,
      "mcp",
      "--project",
      canonicalProject,
    ];
    assert.deepEqual(cursor.launchSpec, {
      command: "node",
      args: expectedArgs,
    });
    assert.deepEqual(codex.launchSpec, cursor.launchSpec);

    const cursorConfig = JSON.parse(
      await readFile(join(project, ".cursor", "mcp.json"), "utf8"),
    );
    assert.equal(cursorConfig.mcpServers.reposcope.command, "node");
    assert.deepEqual(cursorConfig.mcpServers.reposcope.args, expectedArgs);
    assert.equal(
      cursorConfig.mcpServers.reposcope.args.includes("npx"),
      false,
    );

    const codexConfig = await readFile(
      join(project, ".codex", "config.toml"),
      "utf8",
    );
    assert(codexConfig.includes('command = "node"'));
    assert(codexConfig.includes(JSON.stringify(runtimeEntryPath)));
    assert(codexConfig.includes(JSON.stringify(canonicalProject)));
    assert.doesNotMatch(codexConfig, /command = "npx"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-named projects share the runtime binary but keep different hard-bound project args", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-local-runtime-isolation-"));
  const projectA = join(root, "owner-a", "same-name");
  const projectB = join(root, "owner-b", "same-name");
  const runtimeEntryPath = join(
    root,
    "runtime",
    "current",
    "node_modules",
    "reposcope",
    "dist",
    "bin.mjs",
  );

  try {
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });

    const a = await installAgentIntegration("codex", {
      projectRoot: projectA,
      runtimeEntryPath,
    });
    const b = await installAgentIntegration("codex", {
      projectRoot: projectB,
      runtimeEntryPath,
    });

    assert.equal(a.launchSpec.args[0], runtimeEntryPath);
    assert.equal(b.launchSpec.args[0], runtimeEntryPath);
    assert.notEqual(a.launchSpec.args.at(-1), b.launchSpec.args.at(-1));
    assert.equal(a.launchSpec.args.at(-1), await realpath(projectA));
    assert.equal(b.launchSpec.args.at(-1), await realpath(projectB));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
