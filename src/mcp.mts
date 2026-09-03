import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { buildContext, readRepo, searchRepo } from "./core.js";
import { createTextResponse } from "./mcp-response.js";
import { summarizeSession } from "./monitoring.js";
import { getSession, startSession } from "./sessions.js";
import {
  applySessionPatch,
  getSessionRepoDiff,
  getSessionRepoStatus,
} from "./write.js";

const MAX_STATUS_LINES = 200;

function createServer() {
  const server = new McpServer({
    name: "reposcope",
    version: "0.1.0",
  });

  server.registerTool(
    "repo_context",
    {
      description:
        "Build a minimal code context packet for a task within a token budget.",
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
    }) => {
      const result = await buildContext({
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

      const responseText = JSON.stringify({
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
      });

      return createTextResponse("repo_context", responseText, sessionId);
    },
  );

  server.registerTool(
    "repo_search",
    {
      description:
        "Search a repository for files related to one or more code search terms.",
      inputSchema: z.object({
        targetPath: z.string(),
        searchTerms: z.array(z.string()),
        limit: z.number().int().min(1).max(100).optional(),
        sessionId: z.string().optional(),
      }),
    },
    async ({ targetPath, searchTerms, limit, sessionId }) => {
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
    },
  );

  server.registerTool(
    "repo_read",
    {
      description:
        "Read specific repository files within a strict token budget.",
      inputSchema: z.object({
        targetPath: z.string(),
        files: z.array(z.string()),
        budgetTokens: z.number().int().positive(),
        sessionId: z.string().optional(),
      }),
    },
    async ({ targetPath, files, budgetTokens, sessionId }) => {
      const result = await readRepo({
        targetPath,
        files,
        budgetTokens,
        sessionId,
      });
      const parts: string[] = [];

      for (const file of result.files) {
        parts.push(`FILE ${file.path}\n${file.content}`);
      }
      for (const file of result.skippedFiles) {
        parts.push(`SKIP ${file.path} ${file.reason}`);
      }
      if (result.session) {
        parts.push(`REMAINING ${result.session.remainingTokens}`);
      }

      return createTextResponse(
        "repo_read",
        parts.join("\n\n"),
        sessionId,
      );
    },
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
    async ({ targetPath, sessionId }) => {
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
    },
  );

  server.registerTool(
    "repo_apply_patch",
    {
      description:
        "Apply a validated text patch. Existing files must have been read in the current session first.",
      inputSchema: z.object({
        targetPath: z.string(),
        patch: z.string().min(1),
        sessionId: z.string(),
      }),
    },
    async ({ targetPath, patch, sessionId }) => {
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
    },
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
    async ({ targetPath, budgetTokens, sessionId }) => {
      const result = await getSessionRepoDiff({
        targetPath,
        budgetTokens,
        sessionId,
      });
      const header = result.truncated ? "DIFF_TRUNCATED" : "DIFF";
      const responseText = result.diff
        ? `${header}\n${result.diff}`
        : "NO_DIFF";

      return createTextResponse(
        "repo_diff",
        responseText,
        sessionId,
      );
    },
  );

  server.registerTool(
    "repo_session_start",
    {
      description:
        "Start a repository exploration session with a total token budget.",
      inputSchema: z.object({
        targetPath: z.string(),
        task: z.string(),
        budgetTokens: z.number().int().positive(),
      }),
    },
    async ({ targetPath, task, budgetTokens }) => {
      const result = await startSession({
        targetPath,
        task,
        budgetTokens,
      });

      return createTextResponse(
        "repo_session_start",
        JSON.stringify(result),
        result.sessionId,
      );
    },
  );

  server.registerTool(
    "repo_session_status",
    {
      description:
        "Get token usage, exploration history, and remaining budget for a session.",
      inputSchema: z.object({
        sessionId: z.string(),
      }),
    },
    async ({ sessionId }) => {
      const session = getSession(sessionId);

      if (!session) {
        throw new Error("Session not found");
      }

      const metrics = summarizeSession(session);
      const result = {
        ...metrics,
        deliveredByTool: session.deliveredByTool,
        readFiles: session.readFiles,
        events: session.events,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  return server;
}

void serveStdio(createServer);
console.error("RepoScope MCP server running on stdio");
