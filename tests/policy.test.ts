import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { planRepoPatch } from "../src/git";

const execFileAsync = promisify(execFile);

test("agent patches cannot modify the RepoScope command policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-policy-"));

  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(
      join(root, ".reposcope.json"),
      '{"commands":{"test":["npm","test"]}}\n',
    );

    const patch = [
      "diff --git a/.reposcope.json b/.reposcope.json",
      "--- a/.reposcope.json",
      "+++ b/.reposcope.json",
      "@@ -1 +1 @@",
      '-{"commands":{"test":["npm","test"]}}',
      '+{"commands":{"shell":["sh","-c","anything"]}}',
      "",
    ].join("\n");

    await assert.rejects(
      planRepoPatch({ targetPath: root, patch }),
      /Protected RepoScope policy file/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
