import { resolve, join, relative } from "node:path";
import { buildContext } from "./core";
import type { ContextRequest } from "./types";
import {
  appendMonitoringEvent,
  readMonitoringEvents,
  summarizeMonitoring,
} from "./monitoring";
import { OUTPUT_FILES, writeJson, writeText } from "./output";
import { parseCliArgs } from "./cli";

async function main() {
  const request = parseCliArgs(process.argv);

  const {
    targetPath,
    task,
    searchTerms,
    budgetTokens: contextBudget,
  } = request;

  console.log(`Scanning: ${targetPath}`);

  const coreResult = await buildContext(request);

  const fileEntries = coreResult.fileEntries;

  console.log("");
  console.log("Search Terms");
  console.log("------------");
  console.log(searchTerms);

  const searchResults = coreResult.searchResults;

  console.log("");
  console.log("Search Results");
  console.log("--------------");

  for (const result of searchResults) {
    console.log(
      `${relative(targetPath, result.path)} (score: ${result.score})`,
    );
  }

  const contextPacket = coreResult.contextPacket;
  const monitoringEvent = coreResult.monitoringEvent;

  const contextPacketPath = join(targetPath, OUTPUT_FILES.contextPacket);

  await writeText(contextPacketPath, contextPacket);

  console.log(`Found ${fileEntries.length} files:`);

  for (const file of fileEntries) {
    console.log(`${file.path} (${file.sizeBytes} bytes)`);
  }

  const repoMapPath = join(targetPath, OUTPUT_FILES.repoMap);

  await writeJson(repoMapPath, coreResult.repoMap);

  const monitoringLogPath = join(targetPath, OUTPUT_FILES.monitoringLog);

  await appendMonitoringEvent(monitoringLogPath, monitoringEvent);

  const events = await readMonitoringEvents(monitoringLogPath);

  const monitoringSummary = summarizeMonitoring(events);

  const monitoringSummaryPath = join(
    targetPath,
    OUTPUT_FILES.monitoringSummary,
  );

  await writeJson(monitoringSummaryPath, monitoringSummary);

  console.log("");
  console.log("Monitoring Summary");
  console.log("------------------");
  console.log(`Tasks: ${monitoringSummary.totalTasks}`);

  console.log(
    `Whole repo baseline: ${monitoringSummary.wholeRepoBaselineTokens} tokens`,
  );

  console.log(
    `Selected context: ${monitoringSummary.selectedContextTokens} tokens`,
  );

  console.log(`Saved: ${monitoringSummary.savedTokens} tokens`);

  console.log(`Reduction: ${monitoringSummary.reductionPercent.toFixed(2)}%`);

  console.log(`Repo map saved to: ${repoMapPath}`);
}

main();
