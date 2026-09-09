import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { installAgentIntegration } from "../src/integration-setup.mjs";
import { uninstallAgentIntegration } from "../src/integration-uninstall.mjs";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("Cursor uninstall removes only RepoScope project integration", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-uninstall-cursor-"));
  const project = join(root, "project");
  const cursorDir = join(project, ".cursor");
  const mcpPath = join(cursorDir, "mcp.json");
  const otherSkill = join(cursorDir, "skills", "keep-me", "SKILL.md");
  const otherRule = join(cursorDir, "rules", "keep-me.mdc");
  const runtimeEntry = join(root, "runtime", "bin.mjs");

  try {
    await mkdir(join(cursorDir, "skills", "keep-me"), { recursive: true });
    await mkdir(join(cursorDir, "rules"), { recursive: true });
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(runtimeEntry, "runtime\n", "utf8");
    await writeFile(otherSkill, "keep skill\n", "utf8");
    await writeFile(otherRule, "keep rule\n", "utf8");
    await writeFile(
      mcpPath,
      JSON.stringify(
        {
          custom: true,
          mcpServers: {
            existing: { command: "existing", args: ["--keep"] },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await installAgentIntegration("cursor", {
      projectRoot: project,
      packageRoot: process.cwd(),
      runtimeEntryPath: runtimeEntry,
    });

    const first = await uninstallAgentIntegration("cursor", { projectRoot: project });
    const config = JSON.parse(await readFile(mcpPath, "utf8"));

    assert.equal(first.agent, "cursor");
    assert.equal(config.custom, true);
    assert.deepEqual(config.mcpServers.existing, {
      command: "existing",
      args: ["--keep"],
    });
    assert.equal("reposcope" in config.mcpServers, false);
    assert.equal(await exists(join(cursorDir, "rules", "reposcope.mdc")), false);
    assert.equal(await exists(join(cursorDir, "skills", "reposcope")), false);
    assert.equal(await exists(join(cursorDir, "skills", "reposcope-benchmark")), false);
    assert.equal(await readFile(otherSkill, "utf8"), "keep skill\n");
    assert.equal(await readFile(otherRule, "utf8"), "keep rule\n");
    assert.equal(await readFile(runtimeEntry, "utf8"), "runtime\n");

    const second = await uninstallAgentIntegration("cursor", { projectRoot: project });
    assert.deepEqual(second.updatedPaths, []);
    assert.deepEqual(second.removedPaths, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex uninstall removes only RepoScope managed blocks", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-uninstall-codex-"));
  const project = join(root, "project");
  const codexDir = join(project, ".codex");
  const configPath = join(codexDir, "config.toml");
  const agentsPath = join(project, "AGENTS.md");
  const runtimeEntry = join(root, "runtime", "bin.mjs");

  try {
    await mkdir(codexDir, { recursive: true });
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(runtimeEntry, "runtime\n", "utf8");
    await writeFile(
      configPath,
      'model = "gpt-5"\n\n[mcp_servers.existing]\ncommand = "keep"\n',
      "utf8",
    );
    await writeFile(
      agentsPath,
      "# Project guidance\n\nKeep this user guidance.\n",
      "utf8",
    );

    await installAgentIntegration("codex", {
      projectRoot: project,
      runtimeEntryPath: runtimeEntry,
    });

    const first = await uninstallAgentIntegration("codex", { projectRoot: project });
    const config = await readFile(configPath, "utf8");
    const agents = await readFile(agentsPath, "utf8");

    assert.equal(first.agent, "codex");
    assert.match(config, /model = "gpt-5"/);
    assert.match(config, /\[mcp_servers\.existing\]/);
    assert.doesNotMatch(config, /mcp_servers\.reposcope/);
    assert.doesNotMatch(config, /RepoScope managed MCP/);
    assert.match(agents, /# Project guidance/);
    assert.match(agents, /Keep this user guidance\./);
    assert.doesNotMatch(agents, /RepoScope managed guidance/);
    assert.equal(await readFile(runtimeEntry, "utf8"), "runtime\n");

    const second = await uninstallAgentIntegration("codex", { projectRoot: project });
    assert.deepEqual(second.updatedPaths, []);
    assert.deepEqual(second.removedPaths, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
