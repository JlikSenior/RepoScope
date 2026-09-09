import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RUNTIME_SCHEMA_VERSION = 1;
const PACKAGE_NAME = "reposcope";

export type RuntimePathOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platformName?: NodeJS.Platform;
};

export type InstalledRuntime = {
  schemaVersion: 1;
  sourceSpec: string;
  packageVersion: string;
  installedAt: string;
  runtimeRoot: string;
  installDir: string;
  entryPath: string;
};

type RuntimeInstaller = (request: {
  stagingDir: string;
  sourceSpec: string;
  cacheDir: string;
  env: NodeJS.ProcessEnv;
}) => Promise<void>;

export type RuntimeInstallOptions = RuntimePathOptions & {
  installer?: RuntimeInstaller;
};

export function getRuntimeRootPath(
  options: RuntimePathOptions = {},
): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platformName = options.platformName ?? platform();

  if (env.REPOSCOPE_RUNTIME_DIR) {
    return resolve(env.REPOSCOPE_RUNTIME_DIR);
  }

  if (platformName === "win32" && env.LOCALAPPDATA) {
    return join(resolve(env.LOCALAPPDATA), "RepoScope", "runtime");
  }

  if (platformName === "darwin") {
    return join(homeDir, "Library", "Application Support", "RepoScope", "runtime");
  }

  if (env.XDG_DATA_HOME) {
    return join(resolve(env.XDG_DATA_HOME), "reposcope", "runtime");
  }

  return join(homeDir, ".local", "share", "reposcope", "runtime");
}

function runtimePaths(options: RuntimePathOptions = {}) {
  const runtimeRoot = getRuntimeRootPath(options);
  const installDir = join(runtimeRoot, "current");
  return {
    runtimeRoot,
    installDir,
    manifestPath: join(runtimeRoot, "runtime.json"),
    entryPath: join(
      installDir,
      "node_modules",
      PACKAGE_NAME,
      "dist",
      "bin.mjs",
    ),
    packageJsonPath: join(
      installDir,
      "node_modules",
      PACKAGE_NAME,
      "package.json",
    ),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveWindowsNpmCli(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.npm_execpath;
  if (configured && (await exists(configured))) {
    return configured;
  }

  let stdout: string;
  try {
    const result = await execFileAsync("where.exe", ["npm.cmd"], {
      env,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    throw new Error(
      `Cannot locate npm for RepoScope Runtime install: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    const npmCmd = rawLine.trim();
    if (!npmCmd) continue;
    const candidate = join(dirname(npmCmd), "node_modules", "npm", "bin", "npm-cli.js");
    if (await exists(candidate)) return candidate;
  }

  throw new Error(
    "Cannot locate npm-cli.js for RepoScope Runtime install. Run the bootstrap through npx/npm or ensure Node.js npm is installed.",
  );
}

async function executeNpm(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const commonOptions = {
    env,
    maxBuffer: 64 * 1024 * 1024,
  };

  if (process.platform === "win32") {
    const npmCli = await resolveWindowsNpmCli(env);
    await execFileAsync(process.execPath, [npmCli, ...args], commonOptions);
    return;
  }

  await execFileAsync("npm", args, commonOptions);
}

async function defaultInstaller(request: {
  stagingDir: string;
  sourceSpec: string;
  cacheDir: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  await executeNpm(
    [
      "install",
      "--prefix",
      request.stagingDir,
      "--no-save",
      "--no-package-lock",
      "--fund=false",
      "--audit=false",
      request.sourceSpec,
    ],
    {
      ...request.env,
      npm_config_cache: request.cacheDir,
      NPM_CONFIG_CACHE: request.cacheDir,
      npm_config_update_notifier: "false",
    },
  );
}

async function inspectStagedRuntime(
  stagingDir: string,
  sourceSpec: string,
  runtimeRoot: string,
): Promise<InstalledRuntime> {
  const packageJsonPath = join(
    stagingDir,
    "node_modules",
    PACKAGE_NAME,
    "package.json",
  );
  const entryPath = join(
    stagingDir,
    "node_modules",
    PACKAGE_NAME,
    "dist",
    "bin.mjs",
  );

  if (!(await exists(entryPath))) {
    throw new Error(`Installed RepoScope runtime entry is missing: ${entryPath}`);
  }

  let packageVersion: string;
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };

    if (
      packageJson.name !== PACKAGE_NAME ||
      typeof packageJson.version !== "string" ||
      !packageJson.version
    ) {
      throw new Error("Installed package metadata is not RepoScope");
    }
    packageVersion = packageJson.version;
  } catch (error) {
    throw new Error(
      `Cannot validate installed RepoScope runtime: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    sourceSpec,
    packageVersion,
    installedAt: new Date().toISOString(),
    runtimeRoot,
    installDir: join(runtimeRoot, "current"),
    entryPath: join(
      runtimeRoot,
      "current",
      "node_modules",
      PACKAGE_NAME,
      "dist",
      "bin.mjs",
    ),
  };
}

async function writeManifest(path: string, runtime: InstalledRuntime): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function getInstalledRuntime(
  options: RuntimePathOptions = {},
): Promise<InstalledRuntime | undefined> {
  const paths = runtimePaths(options);

  let manifest: InstalledRuntime;
  try {
    manifest = JSON.parse(
      await readFile(paths.manifestPath, "utf8"),
    ) as InstalledRuntime;
  } catch {
    return undefined;
  }

  if (
    manifest.schemaVersion !== RUNTIME_SCHEMA_VERSION ||
    typeof manifest.sourceSpec !== "string" ||
    typeof manifest.packageVersion !== "string" ||
    typeof manifest.installedAt !== "string" ||
    manifest.runtimeRoot !== paths.runtimeRoot ||
    manifest.installDir !== paths.installDir ||
    manifest.entryPath !== paths.entryPath ||
    !(await exists(paths.entryPath)) ||
    !(await exists(paths.packageJsonPath))
  ) {
    return undefined;
  }

  return manifest;
}

export async function installLocalRuntime(
  sourceSpec: string,
  options: RuntimeInstallOptions = {},
): Promise<InstalledRuntime> {
  const runtimeRoot = getRuntimeRootPath(options);
  const id = randomUUID();
  const stagingDir = join(runtimeRoot, `.install-${id}`);
  const cacheDir = join(runtimeRoot, `.npm-cache-${id}`);
  const backupDir = join(runtimeRoot, `.previous-${id}`);
  const currentDir = join(runtimeRoot, "current");
  const manifestPath = join(runtimeRoot, "runtime.json");
  const installer = options.installer ?? defaultInstaller;
  const env = options.env ?? process.env;
  let movedCurrentToBackup = false;

  await mkdir(runtimeRoot, { recursive: true });

  try {
    await mkdir(stagingDir, { recursive: true });
    await installer({ stagingDir, sourceSpec, cacheDir, env });
    const runtime = await inspectStagedRuntime(stagingDir, sourceSpec, runtimeRoot);

    if (await exists(currentDir)) {
      await rename(currentDir, backupDir);
      movedCurrentToBackup = true;
    }

    try {
      await rename(stagingDir, currentDir);
      await writeManifest(manifestPath, runtime);
    } catch (error) {
      await rm(currentDir, { recursive: true, force: true });
      if (movedCurrentToBackup && (await exists(backupDir))) {
        await rename(backupDir, currentDir);
      }
      throw error;
    }

    await rm(backupDir, { recursive: true, force: true });
    return runtime;
  } finally {
    await Promise.all([
      rm(stagingDir, { recursive: true, force: true }),
      rm(cacheDir, { recursive: true, force: true }),
    ]);
  }
}

export async function ensureLocalRuntime(
  sourceSpec: string,
  options: RuntimeInstallOptions = {},
): Promise<InstalledRuntime> {
  const installed = await getInstalledRuntime(options);
  if (installed?.sourceSpec === sourceSpec) return installed;
  return installLocalRuntime(sourceSpec, options);
}
