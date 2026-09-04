import type {
  LocalizationQualityMetrics,
  TaskSession,
} from "./types";

function round(value: number): number {
  return Number(value.toFixed(2));
}

function canonicalLocalizationKey(searchTerms: string[]): string {
  return [...new Set(
    searchTerms
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean),
  )]
    .sort()
    .join("\u0000");
}

export function summarizeLocalizationQuality(
  session: TaskSession,
): LocalizationQualityMetrics | undefined {
  const localizationEvents = session.events.filter(
    (event): event is Extract<
      TaskSession["events"][number],
      { type: "localization" }
    > => event.type === "localization",
  );

  if (localizationEvents.length === 0) return undefined;

  const uniqueLocalizationResults = new Set<string>();
  const uniqueReadFiles = new Set<string>();
  const bestLocalizationRankSeen = new Map<string, number>();
  const firstReadBestRanks = new Map<string, number>();
  const seenLocalizationKeys = new Set<string>();
  let repeatedLocalizationCount = 0;
  let repoSearchCount = 0;
  let repoContextCount = 0;

  for (const event of session.events) {
    if (event.type === "localization") {
      if (event.source === "repo_search") repoSearchCount += 1;
      if (event.source === "repo_context") repoContextCount += 1;

      const localizationKey = canonicalLocalizationKey(event.searchTerms);
      if (localizationKey) {
        if (seenLocalizationKeys.has(localizationKey)) {
          repeatedLocalizationCount += 1;
        } else {
          seenLocalizationKeys.add(localizationKey);
        }
      }

      event.resultFiles.forEach((path, index) => {
        uniqueLocalizationResults.add(path);
        const rank = index + 1;
        const previousRank = bestLocalizationRankSeen.get(path);

        if (previousRank === undefined || rank < previousRank) {
          bestLocalizationRankSeen.set(path, rank);
        }
      });
      continue;
    }

    if (event.type !== "read") continue;

    for (const file of event.files) {
      if (uniqueReadFiles.has(file)) continue;

      uniqueReadFiles.add(file);
      const rank = bestLocalizationRankSeen.get(file);
      if (rank !== undefined) {
        firstReadBestRanks.set(file, rank);
      }
    }
  }

  const readRanks = [...firstReadBestRanks.values()];
  const readFilesFoundByLocalization = firstReadBestRanks.size;
  const readFilesNotFoundByLocalization = Math.max(
    uniqueReadFiles.size - readFilesFoundByLocalization,
    0,
  );
  const readDenominator = uniqueReadFiles.size;
  const localizationResultDenominator = uniqueLocalizationResults.size;
  const localizationCount = localizationEvents.length;
  const averageBestRankOfReadFiles =
    readRanks.length === 0
      ? 0
      : round(readRanks.reduce((sum, rank) => sum + rank, 0) / readRanks.length);
  const hitRate = (limit: number) =>
    readDenominator === 0
      ? 0
      : round((readRanks.filter((rank) => rank <= limit).length / readDenominator) * 100);

  return {
    localizationCount,
    repoSearchCount,
    repoContextCount,
    uniqueLocalizationResults: uniqueLocalizationResults.size,
    uniqueLocalizationResultsRead: readFilesFoundByLocalization,
    localizationResultReadConversionPercent:
      localizationResultDenominator === 0
        ? 0
        : round(
            (readFilesFoundByLocalization / localizationResultDenominator) * 100,
          ),
    uniqueFilesRead: uniqueReadFiles.size,
    readFilesFoundByLocalization,
    readFilesNotFoundByLocalization,
    localizationCoveragePercent:
      readDenominator === 0
        ? 0
        : round((readFilesFoundByLocalization / readDenominator) * 100),
    averageBestRankOfReadFiles,
    top1ReadHitRatePercent: hitRate(1),
    top3ReadHitRatePercent: hitRate(3),
    top5ReadHitRatePercent: hitRate(5),
    repeatedLocalizationCount,
    repeatedLocalizationPercent:
      localizationCount === 0
        ? 0
        : round((repeatedLocalizationCount / localizationCount) * 100),
  };
}
