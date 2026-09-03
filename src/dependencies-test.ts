import { resolve } from "node:path";

import { getDirectDependencies } from "./dependencies";

async function main() {
  const sourceFile = resolve(
    "../reposcope-test/src/payment.ts",
  );

  const dependencies =
    await getDirectDependencies(sourceFile);

  console.log("Dependencies:");
  console.log(dependencies);
}

main();