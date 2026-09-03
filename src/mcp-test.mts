import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({
  name: "reposcope-test-client",
  version: "0.1.0",
});

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp.mts"],
});

await client.connect(transport);

console.log("Connected to MCP server");

const { tools } = await client.listTools();

console.log("");
console.log("Available tools");
console.log("---------------");

for (const tool of tools) {
  console.log(tool.name);
}

// 1. 创建 Session
const sessionResult = await client.callTool({
  name: "repo_session_start",

  arguments: {
    targetPath: "../reposcope-test",
    task: "用户支付为什么失败了",
    budgetTokens: 200,
  },
});

const sessionTextBlock = sessionResult.content.find(
  (block) => block.type === "text",
);

if (!sessionTextBlock || sessionTextBlock.type !== "text") {
  throw new Error("repo_session_start did not return text");
}

const parsedSession = JSON.parse(sessionTextBlock.text);
const sessionId = parsedSession.sessionId;

console.log("");
console.log("Session");
console.log("-------");
console.log(parsedSession);

// 2. 搜索相关文件
const searchResult = await client.callTool({
  name: "repo_search",

  arguments: {
    targetPath: "../reposcope-test",
    searchTerms: ["payment", "billing", "checkout"],
    sessionId,
  },
});

console.log("");
console.log("Search Tool Result");
console.log("------------------");

for (const block of searchResult.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}

const searchTextBlock = searchResult.content.find(
  (block) => block.type === "text",
);

if (!searchTextBlock || searchTextBlock.type !== "text") {
  throw new Error("repo_search did not return text");
}

const parsedSearchResult = JSON.parse(searchTextBlock.text);

const fileHints = parsedSearchResult.results.map(
  (result: { path: string }) => result.path,
);

// 3. 第一次读取：payment.ts
const readResult = await client.callTool({
  name: "repo_read",

  arguments: {
    targetPath: "../reposcope-test",
    files: fileHints,
    budgetTokens: 1000,
    sessionId,
  },
});

console.log("");
console.log("Read Tool Result");
console.log("----------------");

for (const block of readResult.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}

// 4. 第二次读取：user.ts
// 必须使用同一个 sessionId
const secondReadResult = await client.callTool({
  name: "repo_read",

  arguments: {
    targetPath: "../reposcope-test",
    files: ["src/user.ts"],
    budgetTokens: 1000,
    sessionId,
  },
});

console.log("");
console.log("Second Read Result");
console.log("------------------");

for (const block of secondReadResult.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}

// 5. context 测试暂时保留
const result = await client.callTool({
  name: "repo_context",

  arguments: {
    targetPath: "../reposcope-test",
    task: "用户支付为什么失败了",
    searchTerms: ["payment", "billing", "checkout"],
    fileHints,
    budgetTokens: 1000,
    sessionId,
  },
});

console.log("");
console.log("Tool Result");
console.log("-----------");

const statusResult = await client.callTool({
  name: "repo_session_status",

  arguments: {
    sessionId,
  },
});

console.log("");
console.log("Session Status");
console.log("--------------");

for (const block of statusResult.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}

for (const block of result.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}

await client.close();
