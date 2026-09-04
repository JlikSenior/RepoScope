import { relative } from "node:path";

import { parseCliArgs } from "./cli";
import { buildRangeAwareContext } from "./context";
import {
  appendMonitoringEvent,
  readMonitoringEvents,
  summarizeMonitoring,
} from "./monitoring";
import { writeJson, writeText } from "./output";
import { ensureProjectState } from "./state";

async function main() {
  const request = parseCliArgs(process.argv);
  const {
    targetPath,
    searchTerms,
    budgetTokens: contextBudget,
  } = request;

  console.log(`Scanning: ${targetPath}`);

  const coreResult = await buildRangeAwareContext(request);
  const state = await ensureProjectState(targetPath);
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

  await writeText(state.contextPacketPath, coreResult.contextPacket);

  console.log(`Found ${fileEntries.length} files:`);

  for (const file of fileEntries) {
    console.log(`${file.path} (${file.sizeBytes} bytes)`);
  }

  await writeJson(state.repoMapPath, coreResult.repoMap);
  await appendMonitoringEvent(
    state.monitoringLogPath,
    coreResult.monitoringEvent,
  );

  const events = await readMonitoringEvents(state.monitoringLogPath);
  const monitoringSummary = summarizeMonitoring(events);

  await writeJson(state.monitoringSummaryPath, monitoringSummary);

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
  console.log(`Repo map saved to: ${state.repoMapPath}`);
  console.log(`RepoScope state: ${state.projectDir}`);
  console.log(`Context budget: ${contextBudget} tokens`);
}

main();