import { readRepo } from "./core";
import { startSession } from "./sessions";

async function main() {
  const session = await startSession({
    targetPath: "../reposcope-test",
    task: "测试重复读取",
    budgetTokens: 100,
  });

  console.log("Session started:");
  console.log(session);

  const firstRead = await readRepo({
    targetPath: "../reposcope-test",
    files: ["src/payment.ts"],
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });

  console.log("");
  console.log("First read:");
  console.log(JSON.stringify(firstRead, null, 2));

  const secondRead = await readRepo({
    targetPath: "../reposcope-test",
    files: ["src/payment.ts"],
    budgetTokens: 1000,
    sessionId: session.sessionId,
  });

  console.log("");
  console.log("Second read:");
  console.log(JSON.stringify(secondRead, null, 2));
}

main();
