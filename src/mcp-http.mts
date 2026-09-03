import { createServer } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createRepoScopeServer } from "./mcp.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

function readPort(): number {
  const value = Number(process.env.REPOSCOPE_PORT ?? DEFAULT_PORT);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("REPOSCOPE_PORT must be an integer between 1 and 65535");
  }

  return value;
}

const port = readPort();
const handler = createMcpHandler(createRepoScopeServer);
const mcpHandler = toNodeHandler(handler);
const httpServer = createServer((request, response) => {
  const pathname = new URL(
    request.url ?? "/",
    `http://${HOST}:${port}`,
  ).pathname;

  if (request.method === "GET" && pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "reposcope" }));
    return;
  }

  if (pathname !== "/mcp") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  Promise.resolve(mcpHandler(request, response)).catch((error: unknown) => {
    console.error("RepoScope HTTP MCP error", error);

    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal server error");
    }
  });
});

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  await handler.close();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

httpServer.listen(port, HOST, () => {
  console.error(`RepoScope HTTP MCP listening on http://${HOST}:${port}/mcp`);
});
