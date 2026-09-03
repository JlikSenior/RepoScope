import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_MATCHES_PER_FILE = 5;

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
    line_number?: number;
  };
};

export async function searchFiles(
  targetPath: string,
  keywords: string[],
): Promise<SearchResult[]> {
  if (keywords.length === 0) {
    return [];
  }

  const scores = new Map<string, number>();
  const matches = new Map<string, SearchMatch[]>();

  for (const keyword of keywords) {
    try {
      const { stdout } = await execFileAsync(
        "rg",
        [
          "--json",
          "--fixed-strings",
          "--ignore-case",
          keyword,
          targetPath,
        ],
        {
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      const matchedThisKeyword = new Set<string>();

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

        if (!pathText || !line) continue;

        const absolutePath = resolve(pathText);
        matchedThisKeyword.add(absolutePath);

        const fileMatches = matches.get(absolutePath) ?? [];
        if (
          fileMatches.length < MAX_MATCHES_PER_FILE &&
          !fileMatches.some(
            (match) => match.line === line && match.term === keyword,
          )
        ) {
          fileMatches.push({ line, term: keyword });
          matches.set(absolutePath, fileMatches);
        }
      }

      for (const file of matchedThisKeyword) {
        scores.set(file, (scores.get(file) ?? 0) + 1);
      }
    } catch (error: any) {
      // rg returns 1 when there are no matches.
      if (error?.code !== 1) {
        throw error;
      }
    }
  }

  return [...scores.entries()]
    .map(([path, score]) => ({
      path,
      score,
      matches: (matches.get(path) ?? []).sort((a, b) => a.line - b.line),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
