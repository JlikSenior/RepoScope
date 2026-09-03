import { resolve } from "node:path";

import type { ContextRequest } from "./types";

export function parseCliArgs(argv: string[]): ContextRequest {
  const targetPath = resolve(argv[2] ?? ".");
  const task = argv[3] ?? "";
  const budgetTokens = Number(argv[4] ?? 500);

  const searchTerms = (argv[5] ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

  return {
    targetPath,
    task,
    searchTerms,
    budgetTokens,
  };
}