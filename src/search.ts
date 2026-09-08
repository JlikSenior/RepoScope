import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { recordSearchRgPerformance } from "./performance";
import { assertProjectTargetAllowed } from "./project-scope";
import { executeRipgrep } from "./ripgrep";
import { scanDirectoryEntries } from "./scanner";

const MAX_MATCHES_PER_FILE = 5;
const MAX_PATTERNS_PER_PROCESS = 32;
const SEARCH_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const FALLBACK_READ_BATCH_SIZE = 32;

export type SearchMatch = {
  line: number;
  term: string;
};

export type SearchResult = {
  path: string;
  score: number;
  matches: SearchMatch[];
};

type RipgrepJsonLine = {
  type?: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
  };
};

type IndexedKeyword = {
  index: number;
  term: string;
  folded: string;
};

type CandidateMatch = SearchMatch & {
  keywordIndex: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildRipgrepArgs(
  targetPath: string,
  keywords: IndexedKeyword[],
): string[] {
  return [
    "--json",
    "--fixed-strings",
    "--ignore-case",
    ...keywords.flatMap((keyword) => ["-e", keyword.term]),
    targetPath,
  ];
}

function recordLineMatches(
  absolutePath: string,
  line: number,
  lineText: string,
  keywords: IndexedKeyword[],
  matchedKeywordIndices: Map<string, Set<number>>,
  candidateMatches: Map<string, Map<string, CandidateMatch>>,
): void {
  const foldedLine = lineText.toLowerCase();
  const matchedForFile =
    matchedKeywordIndices.get(absolutePath) ?? new Set<number>();
  const matchesForFile =
    candidateMatches.get(absolutePath) ?? new Map<string, CandidateMatch>();

  for (const keyword of keywords) {
    if (!foldedLine.includes(keyword.folded)) {
      continue;
    }

    matchedForFile.add(keyword.index);

    // Preserve the visible-match behavior: duplicate identical terms contribute
    // to score independently but do not duplicate the same line hint.
    const matchKey = `${line}\u0000${keyword.term}`;
    if (!matchesForFile.has(matchKey)) {
      matchesForFile.set(matchKey, {
        line,
        term: keyword.term,
        keywordIndex: keyword.index,
      });
    }
  }

  if (matchedForFile.size > 0) {
    matchedKeywordIndices.set(absolutePath, matchedForFile);
    candidateMatches.set(absolutePath, matchesForFile);
  }
}

async function searchWithPortableFallback(
  targetPath: string,
  indexedKeywords: IndexedKeyword[],
  matchedKeywordIndices: Map<string, Set<number>>,
  candidateMatches: Map<string, Map<string, CandidateMatch>>,
): Promise<Set<string>> {
  const entries = await scanDirectoryEntries(targetPath);

  for (let index = 0; index < entries.length; index += FALLBACK_READ_BATCH_SIZE) {
    const batch = entries.slice(index, index + FALLBACK_READ_BATCH_SIZE);
    const contents = await Promise.all(
      batch.map(async (entry) => {
        try {
          return await readFile(entry.path, "utf8");
        } catch {
          return undefined;
        }
      }),
    );

    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      const content = contents[batchIndex];
      if (content === undefined || content.includes("\0")) continue;

      const entry = batch[batchIndex];
      const lines = content.split(/\r?\n/);

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        recordLineMatches(
          entry.path,
          lineIndex + 1,
          lines[lineIndex],
          indexedKeywords,
          matchedKeywordIndices,
          candidateMatches,
        );
      }
    }
  }

  return new Set(entries.map((entry) => entry.path));
}

export async function searchFiles(
  targetPath: string,
  keywords: string[],
): Promise<SearchResult[]> {
  const searchRoot = resolve(targetPath);
  assertProjectTargetAllowed(searchRoot);

  if (keywords.length === 0) {
    return [];
  }

  const indexedKeywords: IndexedKeyword[] = keywords.map((term, index) => ({
    index,
    term,
    folded: term.toLowerCase(),
  }));
  const matchedKeywordIndices = new Map<string, Set<number>>();
  const candidateMatches = new Map<string, Map<string, CandidateMatch>>();
  let usePortableFallback = false;

  for (const keywordBatch of chunk(indexedKeywords, MAX_PATTERNS_PER_PROCESS)) {
    let stdout: string;
    const rgStartedAt = performance.now();

    try {
      const result = await executeRipgrep(
        buildRipgrepArgs(searchRoot, keywordBatch),
        { maxBuffer: SEARCH_MAX_BUFFER_BYTES },
      );

      if (!result.available) {
        usePortableFallback = true;
        break;
      }

      recordSearchRgPerformance(performance.now() - rgStartedAt);
      stdout = result.stdout;
    } catch (error: any) {
      recordSearchRgPerformance(performance.now() - rgStartedAt);

      // rg returns 1 when there are no matches in this batch.
      if (error?.code === 1) {
        continue;
      }
      throw error;
    }

    for (const rawLine of stdout.split("\n")) {
      if (!rawLine) continue;

      let event: RipgrepJsonLine;
      try {
        event = JSON.parse(rawLine) as RipgrepJsonLine;
      } catch {
        continue;
      }

      if (event.type !== "match") continue;

      const pathText = event.data?.path?.text;
      const line = event.data?.line_number;
      const lineText = event.data?.lines?.text;

      if (!pathText || !line || lineText === undefined) continue;

      recordLineMatches(
        resolve(pathText),
        line,
        lineText,
        keywordBatch,
        matchedKeywordIndices,
        candidateMatches,
      );
    }
  }

  let aiReadableFiles: Set<string>;

  if (usePortableFallback) {
    matchedKeywordIndices.clear();
    candidateMatches.clear();
    aiReadableFiles = await searchWithPortableFallback(
      searchRoot,
      indexedKeywords,
      matchedKeywordIndices,
      candidateMatches,
    );
  } else {
    aiReadableFiles = new Set(
      (await scanDirectoryEntries(searchRoot)).map((entry) => entry.path),
    );
  }

  return [...matchedKeywordIndices.entries()]
    .filter(([path]) => aiReadableFiles.has(path))
    .map(([path, matchedIndices]) => {
      const selectedMatches = [...(candidateMatches.get(path)?.values() ?? [])]
        .sort(
          (a, b) =>
            a.keywordIndex - b.keywordIndex ||
            a.line - b.line ||
            a.term.localeCompare(b.term),
        )
        .slice(0, MAX_MATCHES_PER_FILE)
        .map(({ line, term }) => ({ line, term }))
        .sort((a, b) => a.line - b.line || a.term.localeCompare(b.term));

      return {
        path,
        score: matchedIndices.size,
        matches: selectedMatches,
      };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
