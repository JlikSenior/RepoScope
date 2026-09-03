import { stat } from "node:fs/promises";
import { relative, sep } from "node:path";

import { scanDirectory } from "./scanner.js";

export type RepoStatsEntry = {
  path: string;
  files: number;
  bytes: number;
  estimatedTokens: number;
  percentOfEstimatedTokens: number;
};

export type RepoStatsFile = {
  path: string;
  bytes: number;
  estimatedTokens: number;
  percentOfEstimatedTokens: number;
};

export type RepoStatsReport = {
  schemaVersion: 1;
  targetPath: string;
  estimation: {
    method: "ceil(file_bytes / 4), summed across AI-readable files";
    note: string;
  };
  readableFiles: number;
  readableBytes: number;
  estimatedWholeRepoTokens: number;
  topDirectories: RepoStatsEntry[];
  largestFiles: RepoStatsFile[];
};

type FileStat = {
  path: string;
  relativePath: string;
  bytes: number;
  estimatedTokens: number;
};

function round(value: number): number {
  return Number(value.toFixed(2));
}

function contribution(tokens: number, totalTokens: number): number {
  return totalTokens === 0 ? 0 : round((tokens / totalTokens) * 100);
}

function directoryBucket(relativePath: string): string {
  const normalized = relativePath.split(sep).join("/");
  const parts = normalized.split("/");

  if (parts.length === 1) return "(root)";
  if (parts.length === 2) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

export async function buildRepoStats(
  targetPath: string,
  options?: { topDirectories?: number; largestFiles?: number },
): Promise<RepoStatsReport> {
  const files = await scanDirectory(targetPath);
  const fileStats: FileStat[] = await Promise.all(
    files.map(async (path) => {
      const info = await stat(path);
      return {
        path,
        relativePath: relative(targetPath, path),
        bytes: info.size,
        estimatedTokens: Math.ceil(info.size / 4),
      };
    }),
  );

  const readableBytes = fileStats.reduce((sum, file) => sum + file.bytes, 0);
  const estimatedWholeRepoTokens = fileStats.reduce(
    (sum, file) => sum + file.estimatedTokens,
    0,
  );
  const buckets = new Map<string, { files: number; bytes: number; tokens: number }>();

  for (const file of fileStats) {
    const bucket = directoryBucket(file.relativePath);
    const current = buckets.get(bucket) ?? { files: 0, bytes: 0, tokens: 0 };
    current.files += 1;
    current.bytes += file.bytes;
    current.tokens += file.estimatedTokens;
    buckets.set(bucket, current);
  }

  const topDirectoryLimit = options?.topDirectories ?? 15;
  const largestFileLimit = options?.largestFiles ?? 15;

  const topDirectories = [...buckets.entries()]
    .map(([path, value]) => ({
      path,
      files: value.files,
      bytes: value.bytes,
      estimatedTokens: value.tokens,
      percentOfEstimatedTokens: contribution(
        value.tokens,
        estimatedWholeRepoTokens,
      ),
    }))
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.path.localeCompare(b.path))
    .slice(0, topDirectoryLimit);

  const largestFiles = fileStats
    .map((file) => ({
      path: file.relativePath.split(sep).join("/"),
      bytes: file.bytes,
      estimatedTokens: file.estimatedTokens,
      percentOfEstimatedTokens: contribution(
        file.estimatedTokens,
        estimatedWholeRepoTokens,
      ),
    }))
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.path.localeCompare(b.path))
    .slice(0, largestFileLimit);

  return {
    schemaVersion: 1,
    targetPath,
    estimation: {
      method: "ceil(file_bytes / 4), summed across AI-readable files",
      note: "This is a fast repository-size baseline, not provider billing or exact model tokenization.",
    },
    readableFiles: fileStats.length,
    readableBytes,
    estimatedWholeRepoTokens,
    topDirectories,
    largestFiles,
  };
}
