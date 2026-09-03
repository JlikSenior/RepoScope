import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export type SearchResult = {
  path: string;
  score: number;
};

export async function searchFiles(
  targetPath: string,
  keywords: string[],
): Promise<SearchResult[]> {
  if (keywords.length === 0) {
    return [];
  }

  const scores = new Map<string, number>();

  for (const keyword of keywords) {
    try {
      const { stdout } = await execFileAsync(
        "rg",
        [
          "--files-with-matches",
          "--fixed-strings",
          "--ignore-case",
          keyword,
          targetPath,
        ],
        {
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const matchedFiles = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      for (const file of matchedFiles) {
        const absolutePath = resolve(file);

        scores.set(
          absolutePath,
          (scores.get(absolutePath) ?? 0) + 1,
        );
      }
    } catch (error: any) {
      // rg 返回 1 表示“没有匹配”，不是程序错误
      if (error?.code !== 1) {
        throw error;
      }
    }
  }

  return [...scores.entries()]
    .map(([path, score]) => ({
      path,
      score,
    }))
    .sort((a, b) => b.score - a.score);
}