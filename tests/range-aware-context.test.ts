import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildRangeAwareContext,
  CONTEXT_MATCH_RADIUS_LINES,
} from "../src/context";
import { readRepo } from "../src/core";
import { summarizeSession } from "../src/monitoring";
import { startSession } from "../src/sessions";

function numberedLines(count: number, markers: Record<number, string> = {}): string {
  return Array.from({ length: count }, (_, index) => {
    const line = index + 1;
    return markers[line] ?? `line-${String(line).padStart(3, "0")}`;
  }).join("\n");
}

test("large search-hit files deliver match-centered fragments instead of whole files", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-context-large-"));

  try {
    await writeFile(
      join(root, "large.ts"),
      numberedLines(500, { 300: "needle_context_marker" }),
      "utf8",
    );

    const result = await buildRangeAwareContext({
      targetPath: root,
      task: "inspect marker",
      searchTerms: ["needle_context_marker"],
      budgetTokens: 10000,
    });

    assert.equal(CONTEXT_MATCH_RADIUS_LINES, 40);
    assert.equal(result.selectedFiles.length, 1);
    assert.match(result.contextPacket, /large\.ts \(L260-340 of 500\)/);
    assert.match(result.contextPacket, /needle_context_marker/);
    assert.doesNotMatch(result.contextPacket, /line-001/);
    assert.doesNotMatch(result.contextPacket, /line-500/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nearby search hits merge into one context fragment", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-context-merge-"));

  try {
    await writeFile(
      join(root, "large.ts"),
      numberedLines(500, {
        300: "first_context_marker",
        320: "second_context_marker",
      }),
      "utf8",
    );

    const result = await buildRangeAwareContext({
      targetPath: root,
      task: "inspect nearby markers",
      searchTerms: ["first_context_marker", "second_context_marker"],
      budgetTokens: 10000,
    });

    assert.match(result.contextPacket, /Selected: 1 files \/ 1 fragments/);
    assert.match(result.contextPacket, /large\.ts \(L260-360 of 500\)/);
    assert.equal(
      result.contextPacket.match(/first_context_marker/g)?.length,
      1,
    );
    assert.equal(
      result.contextPacket.match(/second_context_marker/g)?.length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a partial read does not block context around a distant later match", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-context-distant-"));

  try {
    await writeFile(
      join(root, "large.ts"),
      numberedLines(500, { 400: "distant_context_marker" }),
      "utf8",
    );
    const started = await startSession({
      targetPath: root,
      task: "follow distant evidence",
      budgetTokens: 20000,
    });

    await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 100, endLine: 180 }],
      budgetTokens: 10000,
      sessionId: started.sessionId,
    });

    const result = await buildRangeAwareContext({
      targetPath: root,
      task: "follow distant evidence",
      searchTerms: ["distant_context_marker"],
      budgetTokens: 10000,
      sessionId: started.sessionId,
    });

    assert.equal(result.selectedFiles.length, 1);
    assert.match(result.contextPacket, /large\.ts \(L360-440 of 500\)/);
    assert.match(result.contextPacket, /distant_context_marker/);

    const metrics = summarizeSession(
      // startSession guarantees the active record exists through the core calls.
      (await import("../src/sessions")).getSession(started.sessionId)!,
    );
    assert.equal(metrics.sourceLinesRead, 162);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context subtracts only overlapping lines already read", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-context-overlap-"));

  try {
    await writeFile(
      join(root, "large.ts"),
      numberedLines(500, { 300: "overlap_context_marker" }),
      "utf8",
    );
    const started = await startSession({
      targetPath: root,
      task: "inspect overlap",
      budgetTokens: 20000,
    });

    await readRepo({
      targetPath: root,
      ranges: [{ path: "large.ts", startLine: 280, endLine: 300 }],
      budgetTokens: 10000,
      sessionId: started.sessionId,
    });

    const result = await buildRangeAwareContext({
      targetPath: root,
      task: "inspect overlap",
      searchTerms: ["overlap_context_marker"],
      budgetTokens: 10000,
      sessionId: started.sessionId,
    });

    assert.match(result.contextPacket, /Selected: 1 files \/ 2 fragments/);
    assert.match(result.contextPacket, /large\.ts \(L260-279 of 500\)/);
    assert.match(result.contextPacket, /large\.ts \(L301-340 of 500\)/);
    assert.doesNotMatch(result.contextPacket, /overlap_context_marker/);

    const { getSession } = await import("../src/sessions");
    const metrics = summarizeSession(getSession(started.sessionId)!);
    assert.equal(metrics.sourceLinesRead, 81);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("small search-hit files remain whole-file context", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-context-small-"));

  try {
    await writeFile(
      join(root, "small.ts"),
      numberedLines(50, { 25: "small_context_marker" }),
      "utf8",
    );

    const result = await buildRangeAwareContext({
      targetPath: root,
      task: "inspect small file",
      searchTerms: ["small_context_marker"],
      budgetTokens: 10000,
    });

    assert.match(result.contextPacket, /small\.ts \(FULL 50 lines\)/);
    assert.match(result.contextPacket, /line-001/);
    assert.match(result.contextPacket, /line-050/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit large file hints without match lines keep whole-file compatibility", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-context-hint-"));

  try {
    await writeFile(join(root, "hinted.ts"), numberedLines(300), "utf8");

    const result = await buildRangeAwareContext({
      targetPath: root,
      task: "inspect explicit file",
      searchTerms: [],
      fileHints: ["hinted.ts"],
      budgetTokens: 20000,
    });

    assert.equal(result.monitoringEvent.selectionSource, "file_hints");
    assert.match(result.contextPacket, /hinted\.ts \(FULL 300 lines\)/);
    assert.match(result.contextPacket, /line-001/);
    assert.match(result.contextPacket, /line-300/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("range-aware context skips fragments that would exceed packet budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-context-budget-"));

  try {
    const verboseLines = Array.from({ length: 500 }, (_, index) =>
      index === 299
        ? "budget_context_marker " + "payload ".repeat(80)
        : `line-${index + 1} ` + "payload ".repeat(20),
    ).join("\n");
    await writeFile(join(root, "large.ts"), verboseLines, "utf8");

    const result = await buildRangeAwareContext({
      targetPath: root,
      task: "inspect budget marker",
      searchTerms: ["budget_context_marker"],
      budgetTokens: 150,
    });

    assert.equal(result.selectedFiles.length, 0);
    assert(
      result.skippedFiles.some(
        (file) => file.reason === "context_budget_exceeded",
      ),
    );
    assert(result.selectedTokens <= 150);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
