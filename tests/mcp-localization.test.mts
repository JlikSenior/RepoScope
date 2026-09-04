import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const execFileAsync = promisify(execFile);

type TextToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: string; [key: string]: unknown }
  >;
};

function textFrom(result: TextToolResult): string {
  const block = result.content.find((item) => item.type === "text");
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Tool did not return text");
  }
  return block.text;
}

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    ...extra,
  };
}

test("stdio localization quality includes repo_context while search quality stays explicit-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "reposcope-mcp-localization-"));
  const stateRoot = await mkdtemp(
    join(tmpdir(), "reposcope-mcp-localization-state-"),
  );

  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(
    join(root, "alpha.ts"),
    "export const alpha_marker = 1;\nexport const alpha_value = true;\n",
    "utf8",
  );
  await writeFile(
    join(root, "beta.ts"),
    "export const beta_marker = 2;\nexport const beta_value = true;\n",
    "utf8",
  );
  await execFileAsync("git", ["add", "."], { cwd: root });

  const client = new Client({
    name: "reposcope-localization-test",
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp.mts"],
    env: cleanEnv({ REPOSCOPE_STATE_DIR: stateRoot }),
  });

  try {
    await client.connect(transport);

    const startResult = await client.callTool({
      name: "repo_session_start",
      arguments: {
        targetPath: root,
        task: "inspect alpha and beta",
        budgetTokens: 5000,
      },
    });
    const started = JSON.parse(textFrom(startResult as TextToolResult)) as {
      sessionId: string;
    };

    await client.callTool({
      name: "repo_search",
      arguments: {
        targetPath: root,
        searchTerms: ["alpha_marker"],
        sessionId: started.sessionId,
      },
    });

    await client.callTool({
      name: "repo_read",
      arguments: {
        targetPath: root,
        files: ["alpha.ts"],
        budgetTokens: 1000,
        sessionId: started.sessionId,
      },
    });

    await client.callTool({
      name: "repo_context",
      arguments: {
        targetPath: root,
        task: "inspect beta",
        searchTerms: ["beta_marker"],
        budgetTokens: 1000,
        sessionId: started.sessionId,
      },
    });

    const finishResult = await client.callTool({
      name: "repo_session_finish",
      arguments: {
        sessionId: started.sessionId,
        outcome: "success",
      },
    });
    const report = JSON.parse(textFrom(finishResult as TextToolResult)) as {
      metrics: {
        searchCount: number;
        searchQuality: {
          readFilesFoundBySearch: number;
          readFilesNotFoundBySearch: number;
          searchCoveragePercent: number;
        };
        localizationQuality: {
          localizationCount: number;
          repoSearchCount: number;
          repoContextCount: number;
          readFilesFoundByLocalization: number;
          readFilesNotFoundByLocalization: number;
          localizationCoveragePercent: number;
          localizationResultReadConversionPercent: number;
          repeatedLocalizationCount: number;
        };
      };
    };

    assert.equal(report.metrics.searchCount, 1);
    assert.equal(report.metrics.searchQuality.readFilesFoundBySearch, 1);
    assert.equal(report.metrics.searchQuality.readFilesNotFoundBySearch, 1);
    assert.equal(report.metrics.searchQuality.searchCoveragePercent, 50);

    assert.equal(report.metrics.localizationQuality.localizationCount, 2);
    assert.equal(report.metrics.localizationQuality.repoSearchCount, 1);
    assert.equal(report.metrics.localizationQuality.repoContextCount, 1);
    assert.equal(
      report.metrics.localizationQuality.readFilesFoundByLocalization,
      2,
    );
    assert.equal(
      report.metrics.localizationQuality.readFilesNotFoundByLocalization,
      0,
    );
    assert.equal(
      report.metrics.localizationQuality.localizationCoveragePercent,
      100,
    );
    assert.equal(
      report.metrics.localizationQuality.localizationResultReadConversionPercent,
      100,
    );
    assert.equal(
      report.metrics.localizationQuality.repeatedLocalizationCount,
      0,
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
