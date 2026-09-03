import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";

import { OUTPUT_FILES } from "./output";

const execFileAsync = promisify(execFile);

const MAX_AI_FILE_SIZE_BYTES =
  1024 * 1024;

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

  // 编译产物 / 二进制
  ".a",
  ".o",
  ".so",
  ".dll",
  ".exe",
  ".deb",

  // 3D / 大型资源
  ".obj",
  ".stl",
  ".dae",
]);

export async function scanDirectory(
  directoryPath: string,
): Promise<string[]> {
  const targetPath = resolve(directoryPath);

  const { stdout } = await execFileAsync(
    "rg",
    [
      "--files",

      // 允许 .github、.vscode 等隐藏源码配置，
      // 但仍然尊重 .gitignore
      "--hidden",

      // 不读取 .git 本身
      "-g",
      "!.git",

      targetPath,
    ],
    {
      maxBuffer: 50 * 1024 * 1024,
    },
  );

  const candidates = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => resolve(file));

  const files: string[] = [];

  for (const file of candidates) {
    const fileName = basename(file);

    if (IGNORED_FILES.has(fileName)) {
      continue;
    }

    const extension =
      extname(fileName).toLowerCase();

    if (IGNORED_EXTENSIONS.has(extension)) {
      continue;
    }

    const fileStat = await stat(file);

    if (
      fileStat.size >
      MAX_AI_FILE_SIZE_BYTES
    ) {
      continue;
    }

    files.push(file);
  }

  return files;
}