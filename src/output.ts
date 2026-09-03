import { writeFile } from "node:fs/promises";

export const OUTPUT_FILES = {
  contextPacket: "context-packet.md",
  repoMap: "repo-map.json",
  monitoringLog: "monitoring-log.jsonl",
  monitoringSummary: "monitoring-summary.json",
} as const;

export async function writeJson(
  path: string,
  data: unknown,
): Promise<void> {
  await writeFile(
    path,
    JSON.stringify(data, null, 2),
  );
}

export async function writeText(
  path: string,
  content: string,
): Promise<void> {
  await writeFile(path, content);
}