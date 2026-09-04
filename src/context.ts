import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { getEncoding } from "js-tiktoken";

import { scanDirectoryEntries } from "./scanner";
import { searchFiles } from "./search";
import {
  consumeTokens,
  getReadRanges,
  getSession,
  recordReadRange,
  recordSessionEvent,
} from "./sessions";
import type {
  ContextRequest,
  ContextResult,
  FileEntry,
  MonitoringEvent,
  RepoLineRange,
  RepoMap,
  RepoSearchMatch,
  SelectedFile,
  SkippedFile,
} from "./types";

const encoding = getEncoding("cl100k_base");
const MAX_CONTEXT_CANDIDATES = 50;
export const SMALL_CONTEXT_FILE_LINES = 200;
export const CONTEXT_MATCH_RADIUS_LINES = 40;

type ContextFragment = {
  path: string;
  content: string;
  sourceTokens: number;
  totalLines: number;
  startLine: number;
  endLine: number;
};

function mergeRanges(ranges: RepoLineRange[]): RepoLineRange[] {
  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged: RepoLineRange[] = [];

  for (const range of sorted) {
    const previous = merged.at(-1);

    if (!previous || range.startLine > previous.endLine + 1) {
      merged.push(range);
      continue;
    }

    previous.endLine = Math.max(previous.endLine, range.endLine);
  }

  return merged;
}

function subtractRanges(
  requested: RepoLineRange,
  covered: RepoLineRange[],
): RepoLineRange[] {
  let remaining = [requested];

  for (const existing of mergeRanges(covered)) {
    const next: RepoLineRange[] = [];

    for (const range of remaining) {
      if (existing.endLine < range.startLine || existing.startLine > range.endLine) {
        next.push(range);
        continue;
      }

      if (existing.startLine > range.startLine) {
        next.push({
          startLine: range.startLine,
          endLine: existing.startLine - 1,
        });
      }

      if (existing.endLine < range.endLine) {
        next.push({
          startLine: existing.endLine + 1,
          endLine: range.endLine,
        });
      }
    }

    remaining = next;
    if (remaining.length === 0) break;
  }

  return remaining;
}

function buildContextPacket(
  task: string,
  budgetTokens: number,
  fragments: ContextFragment[],
): string {
  const uniqueFiles = new Set(fragments.map((fragment) => fragment.path));
  const sections = fragments.map((fragment) => {
    const location =
      fragment.startLine === 1 && fragment.endLine === fragment.totalLines
        ? `FULL ${fragment.totalLines} lines`
        : `L${fragment.startLine}-${fragment.endLine} of ${fragment.totalLines}`;

    return `## ${fragment.path} (${location})\n\n\`\`\`\n${fragment.content}\n\`\`\``;
  });

  return [
    "# Context Packet",
    "",
    `Task: ${task}`,
    `Budget: ${budgetTokens} tokens`,
    `Selected: ${uniqueFiles.size} files / ${fragments.length} fragments`,
    "",
    ...sections,
  ].join("\n\n");
}

function lineSlice(lines: string[], range: RepoLineRange): string {
  return lines.slice(range.startLine - 1, range.endLine).join("\n");
}

function desiredContextRanges(
  totalLines: number,
  matches: RepoSearchMatch[],
): RepoLineRange[] {
  if (totalLines <= SMALL_CONTEXT_FILE_LINES) {
    return [{ startLine: 1, endLine: totalLines }];
  }

  if (matches.length === 0) {
    return [];
  }

  return mergeRanges(
    matches.map((match) => ({
      startLine: Math.max(1, match.line - CONTEXT_MATCH_RADIUS_LINES),
      endLine: Math.min(totalLines, match.line + CONTEXT_MATCH_RADIUS_LINES),
    })),
  );
}

function validateSessionForRepo(
  sessionId: string | undefined,
  targetPath: string,
): void {
  if (!sessionId) return;

  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.targetPath !== targetPath) {
    throw new Error("Session does not belong to this repository");
  }
}

export async function buildRangeAwareContext(
  request: ContextRequest,
): Promise<ContextResult> {
  const targetPath = resolve(request.targetPath);
  validateSessionForRepo(request.sessionId, targetPath);

  const scannedEntries = await scanDirectoryEntries(targetPath);
  const files = scannedEntries.map((entry) => entry.path);
  const fileEntries: FileEntry[] = scannedEntries.map((entry) => ({
    path: relative(targetPath, entry.path),
    sizeBytes: entry.sizeBytes,
    estimatedTokens: entry.estimatedTokens,
  }));
  const entryByAbsolutePath = new Map(
    scannedEntries.map((entry) => [entry.path, entry] as const),
  );
  const fileEntryByRelativePath = new Map(
    fileEntries.map((entry) => [entry.path, entry] as const),
  );
  const totalBytes = scannedEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const estimatedTokens = scannedEntries.reduce(
    (sum, entry) => sum + entry.estimatedTokens,
    0,
  );
  const wholeRepoTokens = estimatedTokens;

  const termSearchResults =
    request.searchTerms.length > 0
      ? await searchFiles(targetPath, request.searchTerms)
      : [];
  const termSearchByPath = new Map(
    termSearchResults.map((result) => [result.path, result] as const),
  );
  const hintedResults =
    request.fileHints
      ?.map((path, index) => {
        const absolutePath = resolve(targetPath, path);
        const matched = termSearchByPath.get(absolutePath);

        return {
          path: absolutePath,
          score: request.fileHints!.length - index,
          matches: matched?.matches ?? [],
        };
      })
      .filter((result) => entryByAbsolutePath.has(result.path)) ?? [];

  const selectionSource = hintedResults.length > 0 ? "file_hints" : "search";
  const searchResults = hintedResults.length > 0 ? hintedResults : termSearchResults;

  if (
    request.sessionId &&
    selectionSource === "search" &&
    request.searchTerms.length > 0
  ) {
    recordSessionEvent(request.sessionId, {
      type: "localization",
      timestamp: new Date().toISOString(),
      source: "repo_context",
      searchTerms: [...request.searchTerms],
      resultFiles: searchResults
        .slice(0, MAX_CONTEXT_CANDIDATES)
        .map((result) => relative(targetPath, result.path)),
    });
  }

  const selectedFileByPath = new Map<string, SelectedFile>();
  const skippedFiles: SkippedFile[] = [];
  const fragments: ContextFragment[] = [];
  const coverageByPath = new Map<string, RepoLineRange[]>();

  for (const result of searchResults.slice(0, MAX_CONTEXT_CANDIDATES)) {
    const relativePath = relative(targetPath, result.path);
    const fileEntry = fileEntryByRelativePath.get(relativePath);
    if (!fileEntry) continue;

    const content = await readFile(result.path, "utf8");
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;
    const desiredRanges =
      selectionSource === "file_hints" &&
      totalLines > SMALL_CONTEXT_FILE_LINES &&
      result.matches.length === 0
        ? [{ startLine: 1, endLine: totalLines }]
        : desiredContextRanges(totalLines, result.matches);

    if (desiredRanges.length === 0) continue;

    let coverage =
      coverageByPath.get(relativePath) ??
      (request.sessionId ? getReadRanges(request.sessionId, relativePath) : []);
    let deliveredForFile = false;
    let hadUncoveredRange = false;

    for (const desiredRange of desiredRanges) {
      const uncoveredRanges = subtractRanges(desiredRange, coverage);
      if (uncoveredRanges.length > 0) hadUncoveredRange = true;

      for (const range of uncoveredRanges) {
        const fragmentContent = lineSlice(lines, range);
        const sourceTokens = encoding.encode(fragmentContent).length;
        const fragment: ContextFragment = {
          path: relativePath,
          content: fragmentContent,
          sourceTokens,
          totalLines,
          startLine: range.startLine,
          endLine: range.endLine,
        };
        const candidateFragments = [...fragments, fragment];
        const candidatePacket = buildContextPacket(
          request.task,
          request.budgetTokens,
          candidateFragments,
        );
        const candidateTokens = encoding.encode(candidatePacket).length;

        if (candidateTokens > request.budgetTokens) {
          skippedFiles.push({
            path: relativePath,
            reason: "context_budget_exceeded",
            candidateTokens,
            startLine: range.startLine,
            endLine: range.endLine,
          });
          continue;
        }

        fragments.push(fragment);
        coverage = mergeRanges([...coverage, range]);
        coverageByPath.set(relativePath, coverage);
        deliveredForFile = true;
      }
    }

    if (deliveredForFile) {
      selectedFileByPath.set(relativePath, {
        ...fileEntry,
        score: result.score,
      });
    } else if (!hadUncoveredRange) {
      skippedFiles.push({
        path: relativePath,
        reason: "already_read",
        candidateTokens: 0,
      });

      if (request.sessionId) {
        recordSessionEvent(request.sessionId, {
          type: "blocked",
          timestamp: new Date().toISOString(),
          action: "context",
          files: [relativePath],
          reason: "already_read",
        });
      }
    }
  }

  const selectedFiles = [...selectedFileByPath.values()];
  const contextPacket = buildContextPacket(
    request.task,
    request.budgetTokens,
    fragments,
  );
  const selectedTokens = encoding.encode(contextPacket).length;
  const selectedSourceTokens = fragments.reduce(
    (sum, fragment) => sum + fragment.sourceTokens,
    0,
  );

  if (request.sessionId && fragments.length > 0) {
    const consumption = consumeTokens(request.sessionId, selectedSourceTokens);

    if (!consumption.accepted) {
      recordSessionEvent(request.sessionId, {
        type: "blocked",
        timestamp: new Date().toISOString(),
        action: "context",
        files: selectedFiles.map((file) => file.path),
        reason: "context_budget_exceeded",
      });

      throw new Error(
        `Session token budget exceeded. Remaining: ${consumption.remainingTokens}, required: ${selectedSourceTokens}`,
      );
    }

    for (const fragment of fragments) {
      recordReadRange(
        request.sessionId,
        fragment.path,
        {
          startLine: fragment.startLine,
          endLine: fragment.endLine,
        },
        fragment.sourceTokens,
        fragment.totalLines,
      );
      recordSessionEvent(request.sessionId, {
        type: "read",
        timestamp: new Date().toISOString(),
        files: [fragment.path],
        tokens: fragment.sourceTokens,
        ranges: [
          {
            path: fragment.path,
            startLine: fragment.startLine,
            endLine: fragment.endLine,
          },
        ],
      });
    }
  }

  const savedTokens = wholeRepoTokens - selectedTokens;
  const reductionPercent =
    wholeRepoTokens === 0 ? 0 : (savedTokens / wholeRepoTokens) * 100;
  const monitoringEvent: MonitoringEvent = {
    timestamp: new Date().toISOString(),
    repoTokens: wholeRepoTokens,
    budgetTokens: request.budgetTokens,
    selectionSource,
    selectedFiles: selectedFiles.map((file) => file.path),
    skippedFiles,
    selectedTokens,
    savedTokens,
    reductionPercent: Number(reductionPercent.toFixed(2)),
  };
  const repoMap: RepoMap = {
    summary: {
      totalFiles: fileEntries.length,
      totalBytes,
      estimatedTokens,
    },
    monitoring: {
      wholeRepoTokens,
      budgetTokens: request.budgetTokens,
      selectionSource,
      query: {
        task: request.task,
        searchTerms: request.searchTerms,
      },
      searchResults: searchResults.map((result) => ({
        path: relative(targetPath, result.path),
        score: result.score,
        matches: result.matches,
      })),
      selectedFiles: selectedFiles.map((file) => file.path),
      skippedFiles,
      selectedTokens,
      savedTokens,
      reductionPercent: Number(reductionPercent.toFixed(2)),
    },
    files: fileEntries,
  };
  const updatedSession = request.sessionId
    ? getSession(request.sessionId)
    : undefined;

  return {
    targetPath,
    files,
    fileEntries,
    searchResults: searchResults.map((result) => ({
      path: relative(targetPath, result.path),
      score: result.score,
      matches: result.matches,
    })),
    selectedFiles,
    skippedFiles,
    contextPacket,
    monitoringEvent,
    repoMap,
    selectedTokens,
    wholeRepoTokens,
    savedTokens,
    reductionPercent: Number(reductionPercent.toFixed(2)),
    totalBytes,
    estimatedTokens,
    session: updatedSession
      ? {
          sessionId: updatedSession.id,
          usedTokens: updatedSession.usedTokens,
          remainingTokens:
            updatedSession.budgetTokens - updatedSession.usedTokens,
        }
      : undefined,
  };
}
