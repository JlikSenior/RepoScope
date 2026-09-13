import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CODEX_MANAGED_MARKERS,
  installCodexIntegration,
} from "../src/codex-setup.mjs";
import { installAgentIntegration } from "../src/integration-setup.mjs";
import { buildMcpLaunchSpec, DEFAULT_NPX_SPEC } from "../src/mcp-launch.mjs";

function occurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

test("Codex installer preserves existing config and AGENTS content and is idempotent", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-codex-project-"));
  const codexDir = join(project, ".codex");
  const configPath = join(codexDir, "config.toml");
  const agentsPath = join(project, "AGENTS.md");

  try {
    await mkdir(codexDir, { recursive: true });
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");
    await writeFile(agentsPath, "# Existing project guidance\n\nKeep this text.\n", "utf8");

    await installCodexIntegration({
      projectRoot: project,
      packageSpec: "github:JlikSenior/RepoScope#first",
    });

    let config = await readFile(configPath, "utf8");
    let agents = await readFile(agentsPath, "utf8");

    assert.match(config, /model = "gpt-5"/);
    assert.match(config, /\[mcp_servers\.reposcope\]/);
    assert.match(config, /command = "npx"/);
    assert.match(config, /RepoScope#first/);
    assert.match(agents, /# Existing project guidance/);
    assert.match(agents, /Keep this text\./);
    assert.match(agents, /RepoScope assistive repository exploration/);
    assert.match(agents, /Native Codex repository search.*remain allowed/);
    assert.doesNotMatch(agents, /Do not silently bypass RepoScope/);

    await installCodexIntegration({
      projectRoot: project,
      packageSpec: "github:JlikSenior/RepoScope#second",
    });

    config = await readFile(configPath, "utf8");
    agents = await readFile(agentsPath, "utf8");

    assert.equal(occurrences(config, CODEX_MANAGED_MARKERS.mcpStart), 1);
    assert.equal(occurrences(config, CODEX_MANAGED_MARKERS.mcpEnd), 1);
    assert.equal(occurrences(agents, CODEX_MANAGED_MARKERS.agentsStart), 1);
    assert.equal(occurrences(agents, CODEX_MANAGED_MARKERS.agentsEnd), 1);
    assert.doesNotMatch(config, /RepoScope#first/);
    assert.match(config, /RepoScope#second/);
    assert.equal(occurrences(agents, "# Existing project guidance"), 1);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("Codex installer refuses to overwrite an unmanaged reposcope MCP entry", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-codex-conflict-"));
  const codexDir = join(project, ".codex");
  const configPath = join(codexDir, "config.toml");
  const original = '[mcp_servers.reposcope]\ncommand = "custom-reposcope"\n';

  try {
    await mkdir(codexDir, { recursive: true });
    await writeFile(configPath, original, "utf8");

    await assert.rejects(
      installCodexIntegration({ projectRoot: project }),
      /unmanaged \[mcp_servers\.reposcope\]/,
    );

    assert.equal(await readFile(configPath, "utf8"), original);
    await assert.rejects(readFile(join(project, "AGENTS.md"), "utf8"), /ENOENT/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("Cursor and Codex adapters share the same hard-bound MCP launch", async () => {
  const project = await mkdtemp(join(tmpdir(), "reposcope-agent-adapters-"));

  try {
    const canonicalProject = await realpath(project);
    const cursor = await installAgentIntegration("cursor", {
      projectRoot: project,
      packageRoot: process.cwd(),
    });
    const codex = await installAgentIntegration("codex", {
      projectRoot: project,
    });
    const launch = buildMcpLaunchSpec(DEFAULT_NPX_SPEC, canonicalProject);

    assert.equal(cursor.agent, "cursor");
    assert.equal(codex.agent, "codex");
    assert.equal(cursor.projectRoot, canonicalProject);
    assert.equal(codex.projectRoot, canonicalProject);

    const cursorConfig = JSON.parse(
      await readFile(join(project, ".cursor", "mcp.json"), "utf8"),
    );
    assert.equal(cursorConfig.mcpServers.reposcope.command, launch.command);
    assert.deepEqual(cursorConfig.mcpServers.reposcope.args, launch.args);

    const codexConfig = await readFile(join(project, ".codex", "config.toml"), "utf8");
    const expectedArgs = launch.args.map((value) => JSON.stringify(value)).join(", ");
    assert.match(codexConfig, new RegExp(`command = ${JSON.stringify(launch.command)}`));
    assert(codexConfig.includes(`args = [${expectedArgs}]`));
    assert.deepEqual(codex.configPaths, [join(canonicalProject, ".codex", "config.toml")]);
    assert.deepEqual(codex.guidancePaths, [join(canonicalProject, "AGENTS.md")]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
