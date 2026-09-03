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
};

export type ContextResult = {
  targetPath: string;

  files: string[];
  fileEntries: FileEntry[];
  searchResults: {
    path: string;
    score: number;
  }[];

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

    query: {
      task: string;
      searchTerms: string[];
    };

    searchResults: {
      path: string;
      score: number;
    }[];

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
  sessionId?: string;
};

export type RepoSearchResult = {
  targetPath: string;

  results: {
    path: string;
    score: number;
  }[];
};

export type RepoReadRequest = {
  targetPath: string;
  files: string[];
  budgetTokens: number;
  sessionId?: string;
};

export type RepoReadFile = {
  path: string;
  content: string;
  tokens: number;
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

export type TaskSession = {
  id: string;
  targetPath: string;
  task: string;

  budgetTokens: number;
  usedTokens: number;

  wholeRepoTokens: number;
  deliveredTokens: number;
  deliveredByTool: Record<string, number>;

  readFiles: Record<string, number>;
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

  blockedReadCount: number;
  blockedContextCount: number;

  uniqueFilesRead: number;

  utilizationPercent: number;
};
