import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildCursorMcpServer,
  DEFAULT_NPX_SPEC,
  installCursorIntegration,
} from "../src/cursor-setup.mjs";

test("Cursor installer preserves existing MCP servers and installs RepoScope skills", async () => {
  const home = await mkdtemp(join(tmpdir(), "reposcope-cursor-"));
  const cursorDir = join(home, ".cursor");
  const mcpPath = join(cursorDir, "mcp.json");

  try {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(cursorDir, { recursive: true }),
    );
    await writeFile(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          existing: {
            command: "example",
            args: [],
          },
        },
        custom: true,
      }),
    );

    const result = await installCursorIntegration({
      homeDir: home,
      packageRoot: process.cwd(),
    });
    const installed = JSON.parse(await readFile(mcpPath, "utf8"));

    assert.deepEqual(installed.mcpServers.existing, {
      command: "example",
      args: [],
    });
    assert.deepEqual(
      installed.mcpServers.reposcope,
      buildCursorMcpServer(DEFAULT_NPX_SPEC),
    );
    assert.equal(installed.custom, true);
    assert.equal(result.skillPaths.length, 2);

    const normalSkill = await readFile(
      join(home, ".agents", "skills", "reposcope", "SKILL.md"),
      "utf8",
    );
    const benchmarkSkill = await readFile(
      join(home, ".agents", "skills", "reposcope-benchmark", "SKILL.md"),
      "utf8",
    );

    assert.match(normalSkill, /name: reposcope/);
    assert.match(benchmarkSkill, /name: reposcope-benchmark/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Cursor installer refuses to overwrite invalid JSON", async () => {
  const home = await mkdtemp(join(tmpdir(), "reposcope-cursor-invalid-"));
  const cursorDir = join(home, ".cursor");
  const mcpPath = join(cursorDir, "mcp.json");

  try {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(cursorDir, { recursive: true }),
    );
    await writeFile(mcpPath, "{ invalid json", "utf8");

    await assert.rejects(
      installCursorIntegration({ homeDir: home, packageRoot: process.cwd() }),
      /existing file is not valid JSON/,
    );
    assert.equal(await readFile(mcpPath, "utf8"), "{ invalid json");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
