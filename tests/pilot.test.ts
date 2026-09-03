import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("pilot manifest keeps five unique real-history tasks on the fixed revision", async () => {
  const raw = await readFile(
    join(process.cwd(), "benchmarks/pilot/tasks.json"),
    "utf8",
  );
  const manifest = JSON.parse(raw) as {
    schemaVersion: number;
    repository: string;
    startCommit: string;
    tasks: Array<{
      taskId: string;
      prompt: string;
      verifier: string;
    }>;
  };

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repository, "JlikSenior/RepoScope");
  assert.equal(
    manifest.startCommit,
    "12ef553294645d6e96c09d5e77001c87f4054482",
  );
  assert.equal(manifest.tasks.length, 5);
  assert.equal(
    new Set(manifest.tasks.map((task) => task.taskId)).size,
    manifest.tasks.length,
  );

  for (const task of manifest.tasks) {
    assert(task.taskId.length > 0);
    assert(task.prompt.length > 40);
    assert.equal(task.verifier, task.taskId);
  }
});
