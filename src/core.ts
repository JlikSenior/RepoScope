import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { getEncoding } from "js-tiktoken";

import { scanDirectory } from "./scanner";
import { searchFiles } from "./search";
import {
  consumeTokens,
  getReadRanges,
  getSession,
  hasReadFile,
  recordReadFile,
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
  RepoReadFile,
  RepoReadRangeRequest,
  RepoReadRequest,
  RepoReadResult,
  RepoSearchRequest,
  RepoSearchResult,
  SelectedFile,
  SkippedFile,
} from "./types";

const encoding = getEncoding("cl100k_base");
const MAX_CONTEXT_CANDIDATES = 50;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
export const MAX_READ_RANGE_LINES = 400;

function buildContextPacket(
  task: string,
  budgetTokens: number,
  files: { path: string; content: string }[],
): string {
  const contextSections = files.map(
    (file) => `## ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``,
  );

  return [
    "# Context Packet",
    "",
    `Task: ${task}`,
    `Budget: ${budgetTokens} tokens`,
    `Selected: ${files.length} files`,
    "",
    ...contextSections,
  ].join("\n\n");
}

function validateSessionForRepo(
  sessionId: string | undefined,
  targetPath: string,
): void {
  if (!sessionId) {
    return;
  }

  const session = getSession(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  if (session.targetPath !== targetPath) {
    throw new Error("Session does not belong to this repository");
  }
}

function normalizeSearchLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.min(Math.max(Math.floor(limit), 1), MAX_SEARCH_LIMIT);
}

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

function normalizeRequestedRange(
  request: RepoReadRangeRequest,
  totalLines: number,
): RepoLineRange {
  if (
    !Number.isInteger(request.startLine) ||
    !Number.isInteger(request.endLine) ||
    request.startLine < 1 ||
    request.endLine < request.startLine
  ) {
    throw new Error(
      `Invalid line range for ${request.path}: ${request.startLine}-${request.endLine}`,
    );
  }

  if (request.endLine - request.startLine + 1 > MAX_READ_RANGE_LINES) {
    throw new Error(
      `Line range for ${request.path} exceeds ${MAX_READ_RANGE_LINES} lines`,
    );
  }

  const startLine = Math.min(request.startLine, totalLines);
  const endLine = Math.min(request.endLine, totalLines);

  return { startLine, endLine };
}

function lineSlice(lines: string[], range: RepoLineRange): string {
  return lines.slice(range.startLine - 1, range.endLine).join("\n");
}

export async function searchRepo(
  request: RepoSearchRequest,
): Promise<RepoSearchResult> {
  const targetPath = resolve(request.targetPath);
  validateSessionForRepo(request.sessionId, targetPath);

  const searchResults = await searchFiles(targetPath, request.searchTerms);
  const limit = normalizeSearchLimit(request.limit);
  const results = await Promise.all(
    searchResults.slice(0, limit).map(async (result) => {
      const fileStat = await stat(result.path);

      return {
        path: relative(targetPath, result.path),
        score: result.score,
        sizeBytes: fileStat.size,
        estimatedTokens: Math.ceil(fileStat.size / 4),
        matches: result.matches,
      };
    }),
  );

  if (request.sessionId) {
    recordSessionEvent(request.sessionId, {
      type: "search",
      timestamp: new Date().toISOString(),
      searchTerms: request.searchTerms,
      resultFiles: results.map((result) => result.path),
    });
  }

  return {
    targetPath,
    results,
  };
}

export async function readRepo(
  request: RepoReadRequest,
): Promise<RepoReadResult> {
  const targetPath = resolve(request.targetPath);
  validateSessionForRepo(request.sessionId, targetPath);

  const wholeFiles = request.files ?? [];
  const rangedFiles = request.ranges ?? [];

  if (wholeFiles.length === 0 && rangedFiles.length === 0) {
    throw new Error("repo_read requires at least one file or line range");
  }

  const repoFiles = await scanDirectory(targetPath);
  const validFiles = new Set(repoFiles);
  const selectedFiles: RepoReadFile[] = [];
  const skippedFiles: SkippedFile[] = [];
  const contentCache = new Map<
    string,
    { lines: string[]; totalLines: number; relativePath: string }
  >();
  const coverageByPath = new Map<string, RepoLineRange[]>();

  let selectedTokens = 0;

  const loadFile = async (requestedFile: string) => {
    const fullPath = resolve(targetPath, requestedFile);

    if (!validFiles.has(fullPath)) {
      return undefined;
    }

    const cached = contentCache.get(fullPath);
    if (cached) return { fullPath, ...cached };

    const content = await readFile(fullPath, "utf8");
    const lines = content.split(/\r?\n/);
    const relativePath = relative(targetPath, fullPath);
    const loaded = {
      lines,
      totalLines: lines.length,
      relativePath,
    };
    contentCache.set(fullPath, loaded);
    return { fullPath, ...loaded };
  };

  const processRange = async (
    requestedFile: string,
    explicitRange?: RepoReadRangeRequest,
  ) => {
    const loaded = await loadFile(requestedFile);
    if (!loaded) return;

    const { lines, totalLines, relativePath } = loaded;
    const requestedRange = explicitRange
      ? normalizeRequestedRange(explicitRange, totalLines)
      : { startLine: 1, endLine: totalLines };
    const priorCoverage =
      coverageByPath.get(relativePath) ??
      (request.sessionId ? getReadRanges(request.sessionId, relativePath) : []);
    const uncovered = subtractRanges(requestedRange, priorCoverage);

    if (uncovered.length === 0) {
      skippedFiles.push({
        path: relativePath,
        reason: "already_read",
        candidateTokens: 0,
        startLine: requestedRange.startLine,
        endLine: requestedRange.endLine,
      });

      if (request.sessionId) {
        recordSessionEvent(request.sessionId, {
          type: "blocked",
          timestamp: new Date().toISOString(),
          action: "read",
          files: [relativePath],
          reason: "already_read",
        });
      }

      return;
    }

    for (const range of uncovered) {
      const content = lineSlice(lines, range);
      const tokens = encoding.encode(content).length;

      if (selectedTokens + tokens > request.budgetTokens) {
        skippedFiles.push({
          path: relativePath,
          reason: "context_budget_exceeded",
          candidateTokens: selectedTokens + tokens,
          startLine: range.startLine,
          endLine: range.endLine,
        });

        if (request.sessionId) {
          recordSessionEvent(request.sessionId, {
            type: "blocked",
            timestamp: new Date().toISOString(),
            action: "read",
            files: [relativePath],
            reason: "context_budget_exceeded",
          });
        }

        continue;
      }

      if (request.sessionId) {
        const consumption = consumeTokens(request.sessionId, tokens);

        if (!consumption.accepted) {
          skippedFiles.push({
            path: relativePath,
            reason: "context_budget_exceeded",
            candidateTokens: consumption.usedTokens + tokens,
            startLine: range.startLine,
            endLine: range.endLine,
          });

          recordSessionEvent(request.sessionId, {
            type: "blocked",
            timestamp: new Date().toISOString(),
            action: "read",
            files: [relativePath],
            reason: "context_budget_exceeded",
          });

          continue;
        }
      }

      selectedFiles.push({
        path: relativePath,
        content,
        tokens,
        startLine: range.startLine,
        endLine: range.endLine,
        totalLines,
        complete: range.startLine === 1 && range.endLine === totalLines,
      });

      coverageByPath.set(
        relativePath,
        mergeRanges([
          ...priorCoverage,
          ...(coverageByPath.get(relativePath) ?? []),
          range,
        ]),
      );

      if (request.sessionId) {
        recordReadRange(
          request.sessionId,
          relativePath,
          range,
          tokens,
          totalLines,
        );
        recordSessionEvent(request.sessionId, {
          type: "read",
          timestamp: new Date().toISOString(),
          files: [relativePath],
          tokens,
          ranges: [{ path: relativePath, ...range }],
        });
      }

      selectedTokens += tokens;
    }
  };

  for (const requestedFile of wholeFiles) {
    await processRange(requestedFile);
  }

  for (const range of rangedFiles) {
    await processRange(range.path, range);
  }

  const updatedSession = request.sessionId
    ? getSession(request.sessionId)
    : undefined;

  return {
    targetPath,
    files: selectedFiles,
    skippedFiles,
    selectedTokens,
    budgetTokens: request.budgetTokens,
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

export async function buildContext(
  request: ContextRequest,
): Promise<ContextResult> {
  const targetPath = resolve(request.targetPath);
  validateSessionForRepo(request.sessionId, targetPath);

  const files = await scanDirectory(targetPath);
  const fileEntries: FileEntry[] = await Promise.all(
    files.map(async (file) => {
      const fileStat = await stat(file);

      return {
        path: relative(targetPath, file),
        sizeBytes: fileStat.size,
        estimatedTokens: Math.ceil(fileStat.size / 4),
      };
    }),
  );

  const totalBytes = fileEntries.reduce((sum, file) => sum + file.sizeBytes, 0);
  const estimatedTokens = fileEntries.reduce(
    (sum, file) => sum + file.estimatedTokens,
    0,
  );
  const wholeRepoTokens = estimatedTokens;
  const validFilePaths = new Set(files);
  const fileEntryByPath = new Map(
    fileEntries.map((file) => [file.path, file] as const),
  );

  const hintedResults =
    request.fileHints
      ?.map((path, index) => ({
        path: resolve(targetPath, path),
        score: request.fileHints!.length - index,
        matches: [],
      }))
      .filter((result) => validFilePaths.has(result.path)) ?? [];

  const selectionSource = hintedResults.length > 0 ? "file_hints" : "search";
  const searchResults =
    hintedResults.length > 0
      ? hintedResults
      : await searchFiles(targetPath, request.searchTerms);

  const selectedFiles: SelectedFile[] = [];
  const skippedFiles: SkippedFile[] = [];
  const selectedContextFiles: {
    path: string;
    content: string;
    sourceTokens: number;
    totalLines: number;
  }[] = [];

  for (const result of searchResults.slice(0, MAX_CONTEXT_CANDIDATES)) {
    const relativePath = relative(targetPath, result.path);
    const fileEntry = fileEntryByPath.get(relativePath);

    if (!fileEntry) {
      continue;
    }

    if (request.sessionId && hasReadFile(request.sessionId, relativePath)) {
      skippedFiles.push({
        path: relativePath,
        reason: "already_read",
        candidateTokens: 0,
      });

      recordSessionEvent(request.sessionId, {
        type: "blocked",
        timestamp: new Date().toISOString(),
        action: "context",
        files: [relativePath],
        reason: "already_read",
      });

      continue;
    }

    const content = await readFile(result.path, "utf8");
    const sourceTokens = encoding.encode(content).length;
    const candidateFiles = [
      ...selectedContextFiles,
      {
        path: relativePath,
        content,
        sourceTokens,
        totalLines: content.split(/\r?\n/).length,
      },
    ];

    const candidatePacket = buildContextPacket(
      request.task,
      request.budgetTokens,
      candidateFiles,
    );
    const candidateTokens = encoding.encode(candidatePacket).length;

    if (candidateTokens > request.budgetTokens) {
      skippedFiles.push({
        path: relativePath,
        reason: "context_budget_exceeded",
        candidateTokens,
      });
      continue;
    }

    selectedContextFiles.push({
      path: relativePath,
      content,
      sourceTokens,
      totalLines: content.split(/\r?\n/).length,
    });
    selectedFiles.push({
      ...fileEntry,
      score: result.score,
    });
  }

  const contextPacket = buildContextPacket(
    request.task,
    request.budgetTokens,
    selectedContextFiles,
  );
  const selectedTokens = encoding.encode(contextPacket).length;
  const selectedSourceTokens = selectedContextFiles.reduce(
    (sum, file) => sum + file.sourceTokens,
    0,
  );

  if (request.sessionId && selectedContextFiles.length > 0) {
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

    for (const file of selectedContextFiles) {
      recordReadFile(
        request.sessionId,
        file.path,
        file.sourceTokens,
        file.totalLines,
      );
      recordSessionEvent(request.sessionId, {
        type: "read",
        timestamp: new Date().toISOString(),
        files: [file.path],
        tokens: file.sourceTokens,
        ranges: [
          { path: file.path, startLine: 1, endLine: file.totalLines },
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
