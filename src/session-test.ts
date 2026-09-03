import {
  consumeTokens,
  getSession,
  startSession,
} from "./sessions";

async function main() {
  const started = await startSession({
    targetPath: "../reposcope-test",
    task: "测试 Session Budget",
    budgetTokens: 100,
  });

  console.log("Started:");
  console.log(started);

  console.log("");
  console.log("Consume 30:");
  console.log(
    consumeTokens(started.sessionId, 30),
  );

  console.log("");
  console.log("Consume 50:");
  console.log(
    consumeTokens(started.sessionId, 50),
  );

  console.log("");
  console.log("Consume 30 again:");
  console.log(
    consumeTokens(started.sessionId, 30),
  );

  console.log("");
  console.log("Final session:");
  console.log(
    getSession(started.sessionId),
  );
}

main();