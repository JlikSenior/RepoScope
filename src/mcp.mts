import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  loadActiveSessionCheckpoint,
  persistSessionCheckpoint,
  removeSessionCheckpoint,
} from "./active-session.js";
import { buildRangeAwareContext } from "./context.js";
import {
  MAX_READ_RANGE_LINES,
  readRepo,
  searchRepo,
} from "./core.js";
import { createTextResponse } from "./mcp-response.js";
import {
  buildSessionFinishReport,
  summarizeSession,
} from "./monitoring.js";
import { collectToolPerformance } from "./performance.js";
import { listAllowedCommands, runAllowedCommand } from "./runner.js";
import { persistSessionReport } from "./session-history.js";
import {
  finishSession,
  getSessionRecord,
  recordSessionEvent,
  restoreActiveSession,
  startSession,
} from "./sessions.js";
import type { LatencyTool } from "./types.js";
import {
  applySessionPatch,
  getSessionRepoDiff,
  getSessionRepoStatus,
} from "./write.js";

const MAX_STATUS_LINES = 200;

async function recoverSessionIfNeeded(sessionId: string | undefined): Promise<void> {
  if (!sessionId || getSessionRecord(sessionId)) return;

  try {
    const recovered = await loadActiveSessionCheckpoint(sessionId);
    if (recovered) restoreActiveSession(recovered);
  } catch (error) {
    console.error(
      "RepoScope active session recovery failed:",
      error instanceof Error ? (error as Error).message : error,
    );
  }
}

async function persistActiveSessionIfPresent(
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) return;

  const session = getSessionRecord(sessionId);
  if (!session || session.status !== "active") return;

  try {
    await persistSessionCheckpoint(session);
  } catch (error) {
    console.error(
      "RepoScope active session checkpoint failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function sessionTool<T>(
  sessionId: string,
  action: () => Promise<T>,
): Promise<T> {
  await recoverSessionIfNeeded(sessionId);

  try {
    return await action();
  } finally {
    await persistActiveSessionIfPresent(sessionId);
  }
}

async function measuredTool<T>(
  tool: LatencyTool,
  getSessionId: () => string | undefined,
  action: () => Promise<T>,
): Promise<T> {
  const measured = await collectToolPerformance(async () => {
    await recoverSessionIfNeeded(getSessionId());

    try {
      return await action();
    } finally {
      await persistActiveSessionIfPresent(getSessionId());
    }
  });
  const sessionId = getSessionId();

  if (sessionId) {
    const session = getSessionRecord(sessionId);

    if (session?.status === "active") {
      recordSessionEvent(sessionId, {
        type: "latency",
        timestamp: new Date().toISOString(),
        tool,
        durationMs: measured.sample.durationMs,
        failed: measured.sample.failed,
        scan: measured.sample.scan,
        searchRg: measured.sample.searchRg,
      });
    }
  }

  if (measured.error !== undefined) {
    throw measured.error;
  }

  return measured.value as T;
}

export function createRepoScopeServer(): McpServer {
  const server = new McpServer({
    name: "reposcope",
    version: "0.1.0",
  });

  server.registerTool(
    "repo_context",
    {
      description:
        "Build a minimal range-aware code context packet for a task within a token budget. Search-selected large files are delivered as bounded match-centered fragments; expand with ranged repo_read only when needed.",
      inputSchema: z.object({
        targetPath: z.string(),
        task: z.string(),
        searchTerms: z.array(z.string()),
        fileHints: z.array(z.string()).optional(),
        budgetTokens: z.number().int().positive(),
        sessionId: z.string().optional(),
      }),
    },
    async ({
      targetPath,
      task,
      searchTerms,
      fileHints,
      budgetTokens,
      sessionId,
    }) =>
      measuredTool("repo_context", () => sessionId, async () => {
        const result = await buildRangeAwareContext({
          targetPath,
          task,
          searchTerms,
          fileHints,
          budgetTokens,
          sessionId,
        });

        if (result.selectedFiles.length === 0) {
          return createTextResponse(
            "repo_context",
            "NO_NEW_CONTEXT",
            sessionId,
          );
        }

        return createTextResponse(
          "repo_context",
          JSON.stringify({
            contextPacket: result.contextPacket,
            selectedFiles: result.selectedFiles.map((file) => file.path),
            skippedFiles: result.skippedFiles,
            selectionSource: result.monitoringEvent.selectionSource,
            session: result.session
              ? {
                  usedTokens: result.session.usedTokens,
                  remainingTokens: result.session.remainingTokens,
                }
              : undefined,
            tokens: {
              wholeRepo: result.wholeRepoTokens,
              selected: result.selectedTokens,
              saved: result.savedTokens,
              reductionPercent: result.reductionPercent,
            },
          }),
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_search",
    {
      description:
        "Search a repository and return ranked files with bounded match line numbers and estimated file size so the agent can read only relevant ranges.",
      inputSchema: z.object({
        targetPath: z.string(),
        searchTerms: z.array(z.string()),
        limit: z.number().int().min(1).max(100).optional(),
        sessionId: z.string().optional(),
      }),
    },
    async ({ targetPath, searchTerms, limit, sessionId }) =>
      measuredTool("repo_search", () => sessionId, async () => {
        const result = await searchRepo({
          targetPath,
          searchTerms,
          limit,
          sessionId,
        });

        return createTextResponse(
          "repo_search",
          JSON.stringify({ results: result.results }),
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_read",
    {
      description:
        `Read repository source within a strict token budget. Prefer ranges returned from repo_search; each explicit range is capped at ${MAX_READ_RANGE_LINES} lines. Whole-file reads remain supported for small files and compatibility.`,
      inputSchema: z
        .object({
          targetPath: z.string(),
          files: z.array(z.string()).optional(),
          ranges: z
            .array(
              z.object({
                path: z.string(),
                startLine: z.number().int().min(1),
                endLine: z.number().int().min(1),
              }),
            )
            .optional(),
          budgetTokens: z.number().int().positive(),
          sessionId: z.string().optional(),
        })
        .refine(
          (value) =>
            (value.files?.length ?? 0) > 0 || (value.ranges?.length ?? 0) > 0,
          { message: "Provide at least one file or line range" },
        ),
    },
    async ({ targetPath, files, ranges, budgetTokens, sessionId }) =>
      measuredTool("repo_read", () => sessionId, async () => {
        const result = await readRepo({
          targetPath,
          files,
          ranges,
          budgetTokens,
          sessionId,
        });
        const parts: string[] = [];

        for (const file of result.files) {
          const mode = file.complete ? "FULL" : `L${file.startLine}-${file.endLine}`;
          parts.push(
            `FILE ${file.path} ${mode} TOTAL_LINES ${file.totalLines}\n${file.content}`,
          );
        }
        for (const file of result.skippedFiles) {
          const range =
            file.startLine && file.endLine
              ? ` L${file.startLine}-${file.endLine}`
              : "";
          parts.push(`SKIP ${file.path}${range} ${file.reason}`);
        }
        if (result.session) {
          parts.push(`REMAINING ${result.session.remainingTokens}`);
        }

        return createTextResponse(
          "repo_read",
          parts.join("\n\n"),
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_status",
    {
      description:
        "Show the current Git working-tree status for the session repository.",
      inputSchema: z.object({
        targetPath: z.string(),
        sessionId: z.string(),
      }),
    },
    async ({ targetPath, sessionId }) =>
      sessionTool(sessionId, async () => {
        const result = await getSessionRepoStatus({ targetPath, sessionId });
        const visibleLines = result.lines.slice(0, MAX_STATUS_LINES);
        const parts = visibleLines.length > 0 ? [...visibleLines] : ["CLEAN"];

        if (result.lines.length > visibleLines.length) {
          parts.push(`TRUNCATED ${result.lines.length - visibleLines.length}`);
        }

        return createTextResponse(
          "repo_status",
          parts.join("\n"),
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_apply_patch",
    {
      description:
        "Apply a validated text patch. Existing files must have been fully read in the current session first; partial range reads do not authorize RepoScope patching.",
      inputSchema: z.object({
        targetPath: z.string(),
        patch: z.string().min(1),
        sessionId: z.string(),
      }),
    },
    async ({ targetPath, patch, sessionId }) =>
      sessionTool(sessionId, async () => {
        const result = await applySessionPatch({
          targetPath,
          patch,
          sessionId,
        });

        return createTextResponse(
          "repo_apply_patch",
          `APPLIED\n${result.files.join("\n")}`,
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_diff",
    {
      description:
        "Return the current Git diff within a strict output token budget.",
      inputSchema: z.object({
        targetPath: z.string(),
        budgetTokens: z.number().int().min(1).max(16000),
        sessionId: z.string(),
      }),
    },
    async ({ targetPath, budgetTokens, sessionId }) =>
      sessionTool(sessionId, async () => {
        const result = await getSessionRepoDiff({
          targetPath,
          budgetTokens,
          sessionId,
        });
        const header = result.truncated ? "DIFF_TRUNCATED" : "DIFF";

        return createTextResponse(
          "repo_diff",
          result.diff ? `${header}\n${result.diff}` : "NO_DIFF",
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_commands",
    {
      description:
        "List repository commands explicitly allowlisted in .reposcope.json.",
      inputSchema: z.object({
        targetPath: z.string(),
        sessionId: z.string(),
      }),
    },
    async ({ targetPath, sessionId }) =>
      sessionTool(sessionId, async () => {
        const commands = await listAllowedCommands({ targetPath, sessionId });

        return createTextResponse(
          "repo_commands",
          commands.length ? `COMMANDS\n${commands.join("\n")}` : "NO_COMMANDS",
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_run",
    {
      description:
        "Run one command allowlisted by the repository. The agent cannot supply an executable or arguments.",
      inputSchema: z.object({
        targetPath: z.string(),
        command: z.string().min(1),
        budgetTokens: z.number().int().min(32).max(16000),
        timeoutMs: z.number().int().min(1000).max(300000).optional(),
        sessionId: z.string(),
      }),
    },
    async ({ targetPath, command, budgetTokens, timeoutMs, sessionId }) =>
      sessionTool(sessionId, async () => {
        const result = await runAllowedCommand({
          targetPath,
          command,
          budgetTokens,
          timeoutMs,
          sessionId,
        });

        return createTextResponse(
          "repo_run",
          result.truncated
            ? `OUTPUT_TRUNCATED\n${result.output}`
            : result.output,
          sessionId,
        );
      }),
  );

  server.registerTool(
    "repo_session_start",
    {
      description:
        "Start a local repository task session with a total source-token budget.",
      inputSchema: z.object({
        targetPath: z.string(),
        task: z.string(),
        budgetTokens: z.number().int().positive(),
      }),
    },
    async ({ targetPath, task, budgetTokens }) => {
      let startedSessionId: string | undefined;

      return measuredTool("repo_session_start", () => startedSessionId, async () => {
        const result = await startSession({
          targetPath,
          task,
          budgetTokens,
        });
        startedSessionId = result.sessionId;

        return createTextResponse(
          "repo_session_start",
          JSON.stringify(result),
          result.sessionId,
        );
      });
    },
  );

  server.registerTool(
    "repo_session_finish",
    {
      description:
        "Finish and lock a session. Agent-reported outcome is kept separate from command-based verification.",
      inputSchema: z.object({
        sessionId: z.string(),
        outcome: z.enum(["success", "failed", "abandoned"]),
        note: z.string().max(2000).optional(),
      }),
    },
    async ({ sessionId, outcome, note }) => {
      await recoverSessionIfNeeded(sessionId);
      const session = finishSession(sessionId, outcome, note);
      const report = buildSessionFinishReport(session);

      try {
        await persistSessionCheckpoint(session);
      } catch (error) {
        console.error(
          "RepoScope finished session checkpoint failed:",
          error instanceof Error ? error.message : error,
        );
      }

      try {
        await persistSessionReport(session, report);
      } catch (error) {
        console.error(
          "RepoScope session history persistence failed:",
          error instanceof Error ? error.message : error,
        );
      }

      try {
        await removeSessionCheckpoint(session);
      } catch (error) {
        console.error(
          "RepoScope active session cleanup failed:",
          error instanceof Error ? error.message : error,
        );
      }

      return createTextResponse(
        "repo_session_finish",
        JSON.stringify(report),
        sessionId,
      );
    },
  );

  server.registerTool(
    "repo_session_status",
    {
      description:
        "Get metrics and history for an active or finished repository session.",
      inputSchema: z.object({
        sessionId: z.string(),
      }),
    },
    async ({ sessionId }) => {
      await recoverSessionIfNeeded(sessionId);
      const session = getSessionRecord(sessionId);

      if (!session) {
        throw new Error("Session not found");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ...summarizeSession(session),
              deliveredByTool: session.deliveredByTool,
              readFiles: session.readFiles,
              readRanges: session.readRanges,
              fullyReadFiles: Object.keys(session.fullyReadFiles),
              events: session.events,
            }),
          },
        ],
      };
    },
  );

  return server;
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void serveStdio(createRepoScopeServer);
  console.error("RepoScope MCP server running on stdio");
}
