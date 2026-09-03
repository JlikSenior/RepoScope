import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_MATCHES_PER_FILE = 5;
const MAX_PATTERNS_PER_PROCESS = 32;
const SEARCH_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

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

export async function searchFiles(
  targetPath: string,
  keywords: string[],
): Promise<SearchResult[]> {
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

  for (const keywordBatch of chunk(indexedKeywords, MAX_PATTERNS_PER_PROCESS)) {
    let stdout: string;

    try {
      const result = await execFileAsync(
        "rg",
        buildRipgrepArgs(targetPath, keywordBatch),
        {
          maxBuffer: SEARCH_MAX_BUFFER_BYTES,
        },
      );
      stdout = result.stdout;
    } catch (error: any) {
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

      const absolutePath = resolve(pathText);
      const foldedLine = lineText.toLowerCase();
      const matchedForFile = matchedKeywordIndices.get(absolutePath) ?? new Set<number>();
      const matchesForFile = candidateMatches.get(absolutePath) ?? new Map<string, CandidateMatch>();

      for (const keyword of keywordBatch) {
        if (!foldedLine.includes(keyword.folded)) {
          continue;
        }

        matchedForFile.add(keyword.index);

        // Preserve the old visible-match behavior: duplicate identical terms
        // contribute to score independently but do not duplicate the same hint.
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
  }

  return [...matchedKeywordIndices.entries()]
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
