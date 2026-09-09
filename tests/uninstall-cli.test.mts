import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import { installAgentIntegration } from "../src/integration-setup.mjs";

const execFileAsync = promisify(execFile);

test("uninstall CLI removes Codex managed integration and leaves user content", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-uninstall-cli-"));
  const project = join(root, "project");
  const codexDir = join(project, ".codex");
  const configPath = join(codexDir, "config.toml");
  const agentsPath = join(project, "AGENTS.md");

  try {
    await mkdir(codexDir, { recursive: true });
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");
    await writeFile(agentsPath, "# Keep me\n", "utf8");
    await installAgentIntegration("codex", {
      projectRoot: project,
      runtimeEntryPath: join(root, "runtime", "bin.mjs"),
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/bin.mts", "uninstall", "codex", "--project", project],
      {
        cwd: process.cwd(),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const result = JSON.parse(stdout) as {
      agent: string;
      projectRoot: string;
      updatedPaths: string[];
    };

    assert.equal(result.agent, "codex");
    assert.equal(result.updatedPaths.length, 2);
    assert.match(await readFile(configPath, "utf8"), /model = "gpt-5"/);
    assert.doesNotMatch(await readFile(configPath, "utf8"), /mcp_servers\.reposcope/);
    assert.equal((await readFile(agentsPath, "utf8")).trim(), "# Keep me");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
