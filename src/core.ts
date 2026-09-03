import { readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { getEncoding } from "js-tiktoken";

import { scanDirectory } from "./scanner";
import { searchFiles } from "./search";
import type {
  ContextRequest,
  ContextResult,
  FileEntry,
  SelectedFile,
  SkippedFile,
  MonitoringEvent,
  RepoMap,
  RepoSearchRequest,
  RepoSearchResult,
  RepoReadRequest,
  RepoReadResult,
} from "./types";
import {
  consumeTokens,
  getSession,
  hasReadFile,
  recordReadFile,
  recordSessionEvent,
} from "./sessions";
const encoding = getEncoding("cl100k_base");

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

export async function searchRepo(
  request: RepoSearchRequest,
): Promise<RepoSearchResult> {
  const targetPath = resolve(request.targetPath);

  const session = request.sessionId ? getSession(request.sessionId) : undefined;

  if (request.sessionId && !session) {
    throw new Error("Session not found");
  }

  if (session && session.targetPath !== targetPath) {
    throw new Error("Session does not belong to this repository");
  }

  console.error("1. Scanning repository...");

  const files = await scanDirectory(targetPath);

  console.error(`2. Scan complete: ${files.length} files`);

  const searchResults = await searchFiles(targetPath, request.searchTerms);

  const results = searchResults.map((result) => ({
    path: relative(targetPath, result.path),
    score: result.score,
  }));

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

  const session = request.sessionId ? getSession(request.sessionId) : undefined;

  if (request.sessionId && !session) {
    throw new Error("Session not found");
  }

  if (session && session.targetPath !== targetPath) {
    throw new Error("Session does not belong to this repository");
  }

  const repoFiles = await scanDirectory(targetPath);
  const validFiles = new Set(repoFiles);

  const selectedFiles = [];
  const skippedFiles: SkippedFile[] = [];

  let selectedTokens = 0;

  for (const requestedFile of request.files) {
    const fullPath = resolve(targetPath, requestedFile);

    if (!validFiles.has(fullPath)) {
      continue;
    }

    if (request.sessionId && hasReadFile(request.sessionId, requestedFile)) {
      skippedFiles.push({
        path: requestedFile,
        reason: "already_read",
        candidateTokens: 0,
      });

      recordSessionEvent(request.sessionId, {
        type: "blocked",
        timestamp: new Date().toISOString(),
        action: "read",
        files: [requestedFile],
        reason: "already_read",
      });

      continue;
    }

    const content = await readFile(fullPath, "utf8");

    const tokens = encoding.encode(content).length;

    if (selectedTokens + tokens > request.budgetTokens) {
      skippedFiles.push({
        path: requestedFile,
        reason: "context_budget_exceeded",
        candidateTokens: selectedTokens + tokens,
      });

      continue;
    }

    if (request.sessionId) {
      const consumption = consumeTokens(request.sessionId, tokens);

      if (!consumption.accepted) {
        skippedFiles.push({
          path: requestedFile,
          reason: "context_budget_exceeded",
          candidateTokens: consumption.usedTokens + tokens,
        });

        recordSessionEvent(request.sessionId, {
          type: "blocked",
          timestamp: new Date().toISOString(),
          action: "read",
          files: [requestedFile],
          reason: "context_budget_exceeded",
        });

        continue;
      }
    }

    selectedFiles.push({
      path: relative(targetPath, fullPath),
      content,
      tokens,
    });

    if (request.sessionId) {
      recordReadFile(request.sessionId, requestedFile, tokens);

      recordSessionEvent(request.sessionId, {
        type: "read",
        timestamp: new Date().toISOString(),
        files: [requestedFile],
        tokens,
      });
    }

    selectedTokens += tokens;
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

  const session = request.sessionId ? getSession(request.sessionId) : undefined;

  if (request.sessionId && !session) {
    throw new Error("Session not found");
  }

  if (session && session.targetPath !== targetPath) {
    throw new Error("Session does not belong to this repository");
  }

  const files = await scanDirectory(targetPath);

  console.error("3. Reading and tokenizing files...");

  const fileEntries: FileEntry[] = await Promise.all(
    files.map(async (file) => {
      const fileStat = await stat(file);

      return {
        path: relative(targetPath, file),
        sizeBytes: fileStat.size,

        // 整仓只做快速估算，不读取文件内容
        estimatedTokens: Math.ceil(fileStat.size / 4),
      };
    }),
  );
  console.error("4. File tokenization complete");

  console.error("5. Building whole-repo baseline...");

  const totalBytes = fileEntries.reduce((sum, file) => sum + file.sizeBytes, 0);

  const estimatedTokens = fileEntries.reduce(
    (sum, file) => sum + file.estimatedTokens,
    0,
  );
  const wholeRepoTokens = estimatedTokens;

  const validFilePaths = new Set(files);

  const hintedResults =
    request.fileHints
      ?.map((path, index) => ({
        path: resolve(targetPath, path),
        score: request.fileHints!.length - index,
      }))
      .filter((result) => validFilePaths.has(result.path)) ?? [];

  const selectionSource = hintedResults.length > 0 ? "file_hints" : "search";
  console.error("7. Searching repository...");
  const searchResults =
    hintedResults.length > 0
      ? hintedResults
      : await searchFiles(targetPath, request.searchTerms);
  console.error("8. Search complete");
  const selectedFiles: SelectedFile[] = [];
  const skippedFiles: SkippedFile[] = [];

  const selectedContextFiles: {
    path: string;
    content: string;
  }[] = [];

  console.error("9. Building selected context...");

  const contextCandidates = searchResults.slice(0, 50);
  console.error(
    `Search returned ${searchResults.length} results; checking top ${contextCandidates.length}`,
  );
  for (const result of contextCandidates) {
    const relativePath = relative(targetPath, result.path);

    const fileEntry = fileEntries.find((file) => file.path === relativePath);

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

    const candidateFiles = [
      ...selectedContextFiles,
      {
        path: relativePath,
        content,
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
  console.error("10. Selected context ready");

  const selectedSourceTokens = selectedFiles.reduce(
    (sum, file) => sum + file.estimatedTokens,
    0,
  );

  if (request.sessionId && selectedFiles.length > 0) {
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
    searchResults,
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
