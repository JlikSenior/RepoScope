import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { readRepo } from "../src/core";
import { startSession } from "../src/sessions";
import { applySessionPatch } from "../src/write";

const execFileAsync = promisify(execFile);

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reposcope-write-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "node_modules/\n");
  await writeFile(
    join(root, "src/value.ts"),
    'export const value = "before";\n',
  );
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=RepoScope Test",
      "-c",
      "user.email=reposcope@example.com",
      "commit",
      "-q",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
  return root;
}

test("a modified file can be read again after its stale read state is invalidated", async () => {
  const root = await createFixture();

  try {
    const session = await startSession({
      targetPath: root,
      task: "update value",
      budgetTokens: 1000,
    });

    const firstRead = await readRepo({
      targetPath: root,
      files: ["src/value.ts"],
      budgetTokens: 1000,
      sessionId: session.sessionId,
    });
    assert.equal(firstRead.files.length, 1);
    assert.match(firstRead.files[0].content, /before/);

    const patch = [
      "diff --git a/src/value.ts b/src/value.ts",
      "--- a/src/value.ts",
      "+++ b/src/value.ts",
      "@@ -1 +1 @@",
      '-export const value = "before";',
      '+export const value = "after";',
      "",
    ].join("\n");

    await applySessionPatch({
      targetPath: root,
      patch,
      sessionId: session.sessionId,
    });

    const secondRead = await readRepo({
      targetPath: root,
      files: ["src/value.ts"],
      budgetTokens: 1000,
      sessionId: session.sessionId,
    });

    assert.equal(secondRead.files.length, 1);
    assert.match(secondRead.files[0].content, /after/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
