import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parsePackageVersion(version) {
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`package.json version must be valid SemVer, got ${JSON.stringify(version)}`);
  }

  const [, major, minor, patch, prerelease = null, build = null] = version.match(SEMVER_PATTERN);
  if (prerelease) {
    for (const identifier of prerelease.split(".")) {
      if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
        throw new Error(`package.json version must be valid SemVer, got ${JSON.stringify(version)}`);
      }
    }
  }

  return {
    version,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
    build,
  };
}

export function expectedReleaseTag(version) {
  parsePackageVersion(version);
  return `v${version}`;
}

export function validateReleaseTag(version, tag) {
  const parsed = parsePackageVersion(version);
  const expectedTag = expectedReleaseTag(version);

  if (tag !== expectedTag) {
    throw new Error(`release tag must exactly match package version: expected ${expectedTag}, got ${tag || "<missing>"}`);
  }

  return {
    ...parsed,
    tag,
    isPrerelease: parsed.prerelease !== null,
  };
}

function parseArgs(argv) {
  let tag;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") {
      tag = argv[index + 1];
      if (!tag) {
        throw new Error("--tag requires a value");
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { tag };
}

async function runCli() {
  const { tag: explicitTag } = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packagePath = path.resolve(scriptDir, "..", "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const parsed = parsePackageVersion(packageJson.version);
  const tag = explicitTag ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);

  if (tag) {
    const release = validateReleaseTag(parsed.version, tag);
    console.log(`Release policy OK: ${release.tag} matches package version ${release.version}`);
    return;
  }

  console.log(`Release policy OK: package version ${parsed.version}; expected release tag ${expectedReleaseTag(parsed.version)}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
