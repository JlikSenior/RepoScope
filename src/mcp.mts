import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { buildContext, searchRepo, readRepo } from "./core";
import { startSession, getSession } from "./sessions";
import { summarizeSession } from "./monitoring";
import { createTextResponse } from "./mcp-response";

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
        const responseText = "NO_NEW_CONTEXT";

        return createTextResponse("repo_context", responseText, sessionId);
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
        sessionId: z.string().optional(),
      }),
    },

    async ({ targetPath, searchTerms, sessionId }) => {
      const result = await searchRepo({
        targetPath,
        searchTerms,
        sessionId,
      });

      const responseText = JSON.stringify({
        results: result.results,
      });

      return createTextResponse("repo_search", responseText, sessionId);
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

      const responseText = parts.join("\n\n");

      return createTextResponse("repo_read", responseText, sessionId);
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "repo_session_status",
    {
      description:
        "Get the current token usage and remaining budget for a repository exploration session.",

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
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

void serveStdio(createServer);

console.error("RepoScope MCP server running on stdio");
