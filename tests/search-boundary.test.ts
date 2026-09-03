import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { searchFiles } from "../src/search";

test("search returns only files inside the AI-readable scanner boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-search-boundary-"));

  try {
    await writeFile(
      join(root, "small.ts"),
      "export const BOUNDARY_NEEDLE = true;\n",
      "utf8",
    );
    await writeFile(
      join(root, "package-lock.json"),
      '{"name":"BOUNDARY_NEEDLE"}\n',
      "utf8",
    );
    await writeFile(
      join(root, "huge.ts"),
      `export const BOUNDARY_NEEDLE = true;\n${"x".repeat(1024 * 1024 + 64)}\n`,
      "utf8",
    );

    const results = await searchFiles(root, ["BOUNDARY_NEEDLE"]);

    assert.deepEqual(
      results.map((result) => result.path.split("/").at(-1)),
      ["small.ts"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
