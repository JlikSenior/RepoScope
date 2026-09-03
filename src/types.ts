export type RepoLineRange = {
  startLine: number;
  endLine: number;
};

export type RepoSearchMatch = {
  line: number;
  term: string;
};

export type ContextRequest = {
  targetPath: string;
  task: string;
  searchTerms: string[];
  fileHints?: string[];
  budgetTokens: number;
  sessionId?: string;
};

export type FileEntry = {
  path: string;
  sizeBytes: number;
  estimatedTokens: number;
};

export type SelectedFile = FileEntry & {
  score: number;
};

export type SkippedFile = {
  path: string;
  reason: "context_budget_exceeded" | "already_read";
  candidateTokens: number;
  startLine?: number;
  endLine?: number;
};

export type ContextResult = {
  targetPath: string;
  files: string[];
  fileEntries: FileEntry[];
  searchResults: Array<{
    path: string;
    score: number;
    matches?: RepoSearchMatch[];
  }>;
  selectedFiles: SelectedFile[];
  skippedFiles: SkippedFile[];
  contextPacket: string;
  monitoringEvent: MonitoringEvent;
  repoMap: RepoMap;
  selectedTokens: number;
  wholeRepoTokens: number;
  savedTokens: number;
  reductionPercent: number;
  totalBytes: number;
  estimatedTokens: number;
  session?: {
    sessionId: string;
    usedTokens: number;
    remainingTokens: number;
  };
};

export type MonitoringEvent = {
  timestamp: string;
  repoTokens: number;
  budgetTokens: number;
  selectionSource: "search" | "file_hints";
  selectedFiles: string[];
  skippedFiles: SkippedFile[];
  selectedTokens: number;
  savedTokens: number;
  reductionPercent: number;
};

export type RepoMap = {
  summary: {
    totalFiles: number;
    totalBytes: number;
    estimatedTokens: number;
  };
  monitoring: {
    wholeRepoTokens: number;
    budgetTokens: number;
    selectionSource: "search" | "file_hints";
    query: { task: string; searchTerms: string[] };
    searchResults: Array<{
      path: string;
      score: number;
      matches?: RepoSearchMatch[];
    }>;
    selectedFiles: string[];
    skippedFiles: SkippedFile[];
    selectedTokens: number;
    savedTokens: number;
    reductionPercent: number;
  };
  files: FileEntry[];
};

export type MonitoringSummary = {
  totalTasks: number;
  wholeRepoBaselineTokens: number;
  selectedContextTokens: number;
  savedTokens: number;
  reductionPercent: number;
};

export type RepoSearchRequest = {
  targetPath: string;
  searchTerms: string[];
  limit?: number;
  sessionId?: string;
};

export type RepoSearchResult = {
  targetPath: string;
  results: Array<{
    path: string;
    score: number;
    sizeBytes: number;
    estimatedTokens: number;
    matches: RepoSearchMatch[];
  }>;
};

export type RepoReadRangeRequest = RepoLineRange & {
  path: string;
};

export type RepoReadRequest = {
  targetPath: string;
  files?: string[];
  ranges?: RepoReadRangeRequest[];
  budgetTokens: number;
  sessionId?: string;
};

export type RepoReadFile = {
  path: string;
  content: string;
  tokens: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  complete: boolean;
};

export type RepoReadResult = {
  targetPath: string;
  files: RepoReadFile[];
  skippedFiles: SkippedFile[];
  selectedTokens: number;
  budgetTokens: number;
  session?: {
    sessionId: string;
    usedTokens: number;
    remainingTokens: number;
  };
};

export type RepoStatusRequest = { targetPath: string };
export type RepoStatusResult = { targetPath: string; lines: string[] };
export type RepoApplyPatchRequest = { targetPath: string; patch: string };
export type RepoApplyPatchResult = { targetPath: string; files: string[] };
export type RepoDiffRequest = { targetPath: string; budgetTokens: number };
export type RepoDiffResult = {
  targetPath: string;
  diff: string;
  tokens: number;
  truncated: boolean;
};

export type RepoRunResult = {
  targetPath: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
  outputTokens: number;
  truncated: boolean;
};

export type SessionOutcome = "success" | "failed" | "abandoned";
export type SessionVerificationStatus = "passed" | "failed" | "not_run";

export type TaskSession = {
  id: string;
  targetPath: string;
  task: string;
  status: "active" | "finished";
  outcome?: SessionOutcome;
  note?: string;
  finishedAt?: string;
  budgetTokens: number;
  usedTokens: number;
  wholeRepoTokens: number;
  deliveredTokens: number;
  deliveredByTool: Record<string, number>;
  readFiles: Record<string, number>;
  readRanges: Record<string, RepoLineRange[]>;
  fullyReadFiles: Record<string, true>;
  events: SessionEvent[];
  createdAt: string;
};

export type StartSessionRequest = {
  targetPath: string;
  task: string;
  budgetTokens: number;
};

export type StartSessionResult = {
  sessionId: string;
  budgetTokens: number;
  usedTokens: number;
  remainingTokens: number;
  wholeRepoTokens: number;
};

export type SessionEvent =
  | {
      type: "search";
      timestamp: string;
      searchTerms: string[];
      resultFiles: string[];
    }
  | {
      type: "read";
      timestamp: string;
      files: string[];
      tokens: number;
      ranges?: Array<{ path: string; startLine: number; endLine: number }>;
    }
  | {
      type: "write";
      timestamp: string;
      files: string[];
    }
  | {
      type: "run";
      timestamp: string;
      command: string;
      exitCode: number | null;
      timedOut: boolean;
      durationMs: number;
    }
  | {
      type: "finish";
      timestamp: string;
      outcome: SessionOutcome;
      note?: string;
    }
  | {
      type: "blocked";
      timestamp: string;
      action: "read" | "context";
      files: string[];
      reason: "context_budget_exceeded" | "already_read";
    };

export type SessionMetrics = {
  sessionId: string;
  status: "active" | "finished";
  outcome?: SessionOutcome;
  finishedAt?: string;
  budgetTokens: number;
  usedTokens: number;
  remainingTokens: number;
  wholeRepoTokens: number;
  deliveredTokens: number;
  toolOverheadTokens: number;
  toolOverheadPercent: number;
  sourceReductionPercent: number;
  netContextReductionPercent: number;
  searchCount: number;
  readCount: number;
  writeCount: number;
  runCount: number;
  failedRunCount: number;
  blockedReadCount: number;
  blockedContextCount: number;
  uniqueFilesRead: number;
  sourceLinesRead: number;
  utilizationPercent: number;
};

export type SessionFinishReport = {
  sessionId: string;
  task: string;
  outcome: SessionOutcome;
  note?: string;
  finishedAt: string;
  verification: {
    status: SessionVerificationStatus;
    command?: string;
    exitCode?: number | null;
    timedOut?: boolean;
  };
  changedFiles: string[];
  metrics: SessionMetrics;
};