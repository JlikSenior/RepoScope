import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildCursorMcpServer,
  DEFAULT_NPX_SPEC,
  installCursorIntegration,
} from "../src/cursor-setup.mjs";

test("Cursor installer defaults to project scope and installs MCP, skills, and always-on rule", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-cursor-project-"));
  const project = join(root, "project");
  const home = join(root, "home");
  const cursorDir = join(project, ".cursor");
  const mcpPath = join(cursorDir, "mcp.json");

  try {
    await mkdir(cursorDir, { recursive: true });
    await mkdir(home, { recursive: true });
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
      projectRoot: project,
      homeDir: home,
      packageRoot: process.cwd(),
    });
    const installed = JSON.parse(await readFile(mcpPath, "utf8"));

    assert.equal(result.scope, "project");
    assert.equal(result.projectRoot, project);
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
    assert.equal(
      result.rulePath,
      join(project, ".cursor", "rules", "reposcope.mdc"),
    );

    const normalSkill = await readFile(
      join(project, ".cursor", "skills", "reposcope", "SKILL.md"),
      "utf8",
    );
    const benchmarkSkill = await readFile(
      join(project, ".cursor", "skills", "reposcope-benchmark", "SKILL.md"),
      "utf8",
    );
    const rule = await readFile(
      join(project, ".cursor", "rules", "reposcope.mdc"),
      "utf8",
    );

    assert.match(normalSkill, /name: reposcope/);
    assert.match(benchmarkSkill, /name: reposcope-benchmark/);
    assert.match(rule, /alwaysApply: true/);
    assert.match(rule, /Do not use Cursor built-in codebase search/);

    await assert.rejects(
      readFile(join(home, ".cursor", "mcp.json"), "utf8"),
      /ENOENT/,
    );
    await assert.rejects(
      readFile(join(home, ".agents", "skills", "reposcope", "SKILL.md"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cursor installer supports explicit global scope without project rule", async () => {
  const home = await mkdtemp(join(tmpdir(), "reposcope-cursor-global-"));

  try {
    const result = await installCursorIntegration({
      scope: "global",
      homeDir: home,
      packageRoot: process.cwd(),
    });

    assert.equal(result.scope, "global");
    assert.equal(result.projectRoot, undefined);
    assert.equal(result.rulePath, undefined);

    const installed = JSON.parse(
      await readFile(join(home, ".cursor", "mcp.json"), "utf8"),
    );
    assert.deepEqual(
      installed.mcpServers.reposcope,
      buildCursorMcpServer(DEFAULT_NPX_SPEC),
    );
    assert.match(
      await readFile(
        join(home, ".agents", "skills", "reposcope", "SKILL.md"),
        "utf8",
      ),
      /name: reposcope/,
    );
    await assert.rejects(
      readFile(join(home, ".cursor", "rules", "reposcope.mdc"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("project Cursor installer refuses to overwrite invalid JSON", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-cursor-invalid-"));
  const cursorDir = join(project, ".cursor");
  const mcpPath = join(cursorDir, "mcp.json");

  try {
    await mkdir(cursorDir, { recursive: true });
    await writeFile(mcpPath, "{ invalid json", "utf8");

    await assert.rejects(
      installCursorIntegration({ projectRoot: project, packageRoot: process.cwd() }),
      /existing file is not valid JSON/,
    );
    assert.equal(await readFile(mcpPath, "utf8"), "{ invalid json");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
