import { readCurrentBuildInfo } from "./build-info.mjs";
import { getInstalledRuntime } from "./runtime-install.mjs";
import { readInstalledRuntimeBuildInfo } from "./runtime-update.mjs";

export async function buildVersionReport() {
  const cli = await readCurrentBuildInfo();
  const runtime = await getInstalledRuntime();

  return {
    schemaVersion: 1,
    cli,
    runtime: runtime
      ? {
          ...runtime,
          build: await readInstalledRuntimeBuildInfo(runtime),
        }
      : null,
  };
}
