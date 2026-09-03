import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { searchFiles } from "../src/search";

test("batched search preserves multi-term file scoring and match hints", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-search-batch-"));

  try {
    await writeFile(join(root, "both.ts"), "const alpha = true;\nconst beta = true;\n");
    await writeFile(join(root, "alpha.ts"), "const ALPHA = true;\n");
    await writeFile(join(root, "beta.ts"), "const beta = true;\n");

    const results = await searchFiles(root, ["alpha", "beta"]);
    const both = results.find((result) => result.path.endsWith("both.ts"));
    const alpha = results.find((result) => result.path.endsWith("alpha.ts"));
    const beta = results.find((result) => result.path.endsWith("beta.ts"));

    assert(both);
    assert(alpha);
    assert(beta);
    assert.equal(both.score, 2);
    assert.equal(alpha.score, 1);
    assert.equal(beta.score, 1);
    assert.deepEqual(both.matches, [
      { line: 1, term: "alpha" },
      { line: 2, term: "beta" },
    ]);
    assert.equal(results[0].path, both.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("batched search preserves duplicate-term scoring without duplicate hints", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-search-duplicates-"));

  try {
    await writeFile(join(root, "sample.ts"), "const alpha = true;\n");

    const [result] = await searchFiles(root, ["alpha", "alpha"]);

    assert(result);
    assert.equal(result.score, 2);
    assert.deepEqual(result.matches, [{ line: 1, term: "alpha" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search terms beyond one process batch keep their scores", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-search-many-"));
  const terms = Array.from(
    { length: 33 },
    (_, index) => `needle_${String(index).padStart(2, "0")}_end`,
  );

  try {
    await writeFile(
      join(root, "many.ts"),
      `${terms.map((term) => `const ${term} = true;`).join("\n")}\n`,
    );

    const [result] = await searchFiles(root, terms);

    assert(result);
    assert.equal(result.score, 33);
    assert.equal(result.matches.length, 5);
    assert.deepEqual(
      result.matches.map((match) => match.term),
      terms.slice(0, 5),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
