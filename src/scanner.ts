import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";

import { OUTPUT_FILES } from "./output";

const execFileAsync = promisify(execFile);

const MAX_AI_FILE_SIZE_BYTES = 1024 * 1024;
const STAT_BATCH_SIZE = 128;
const SCAN_CACHE_TTL_MS = 15_000;

const IGNORED_FILES = new Set([
  OUTPUT_FILES.repoMap,
  OUTPUT_FILES.monitoringLog,
  OUTPUT_FILES.monitoringSummary,
  OUTPUT_FILES.contextPacket,
  "package-lock.json",
]);

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".a",
  ".o",
  ".so",
  ".dll",
  ".exe",
  ".deb",
  ".obj",
  ".stl",
  ".dae",
]);

export type ScannedFileEntry = {
  path: string;
  sizeBytes: number;
  estimatedTokens: number;
};

type ScanCacheEntry = {
  expiresAt: number;
  entries: ScannedFileEntry[];
};

const scanCache = new Map<string, ScanCacheEntry>();
const scansInFlight = new Map<string, Promise<ScannedFileEntry[]>>();

function passesStaticAiReadableRules(filePath: string): boolean {
  const fileName = basename(filePath);

  if (IGNORED_FILES.has(fileName)) return false;

  const extension = extname(fileName).toLowerCase();
  return !IGNORED_EXTENSIONS.has(extension);
}

export async function getScannedFileEntry(
  filePath: string,
): Promise<ScannedFileEntry | undefined> {
  const path = resolve(filePath);

  if (!passesStaticAiReadableRules(path)) return undefined;

  try {
    const fileStat = await stat(path);

    if (!fileStat.isFile() || fileStat.size > MAX_AI_FILE_SIZE_BYTES) {
      return undefined;
    }

    return {
      path,
      sizeBytes: fileStat.size,
      estimatedTokens: Math.ceil(fileStat.size / 4),
    };
  } catch {
    return undefined;
  }
}

async function performDirectoryScan(
  targetPath: string,
): Promise<ScannedFileEntry[]> {
  const { stdout } = await execFileAsync(
    "rg",
    ["--files", "--hidden", "-g", "!.git", targetPath],
    { maxBuffer: 50 * 1024 * 1024 },
  );

  const candidates = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => resolve(file))
    .filter(passesStaticAiReadableRules);

  const entries: ScannedFileEntry[] = [];

  for (let index = 0; index < candidates.length; index += STAT_BATCH_SIZE) {
    const batch = candidates.slice(index, index + STAT_BATCH_SIZE);
    const batchEntries = await Promise.all(batch.map(getScannedFileEntry));

    for (const entry of batchEntries) {
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

export function invalidateDirectoryScan(directoryPath: string): void {
  scanCache.delete(resolve(directoryPath));
}

export async function scanDirectoryEntries(
  directoryPath: string,
): Promise<ScannedFileEntry[]> {
  const targetPath = resolve(directoryPath);
  const now = Date.now();
  const cached = scanCache.get(targetPath);

  if (cached && cached.expiresAt > now) {
    return cached.entries;
  }

  const existingScan = scansInFlight.get(targetPath);
  if (existingScan) return existingScan;

  const scan = performDirectoryScan(targetPath);
  scansInFlight.set(targetPath, scan);

  try {
    const entries = await scan;
    scanCache.set(targetPath, {
      entries,
      expiresAt: Date.now() + SCAN_CACHE_TTL_MS,
    });
    return entries;
  } finally {
    scansInFlight.delete(targetPath);
  }
}

export async function scanDirectory(directoryPath: string): Promise<string[]> {
  const entries = await scanDirectoryEntries(directoryPath);
  return entries.map((entry) => entry.path);
}
