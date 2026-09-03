import { readRepo } from "./core";

async function main() {
  const result = await readRepo({
    targetPath: "../reposcope-test",

    files: [
      "src/payment.ts",
      "src/user.ts",
      "../../etc/passwd",
    ],

    budgetTokens: 1000,
  });

  console.log(
    JSON.stringify(result, null, 2),
  );
}

main();