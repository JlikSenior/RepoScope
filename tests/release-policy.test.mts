import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedReleaseTag,
  parsePackageVersion,
  validateReleaseTag,
} from "../scripts/release-policy.mjs";

test("parses stable and prerelease SemVer package versions", () => {
  assert.deepEqual(parsePackageVersion("0.1.0"), {
    version: "0.1.0",
    major: 0,
    minor: 1,
    patch: 0,
    prerelease: null,
    build: null,
  });

  assert.equal(parsePackageVersion("1.0.0-beta.2+build.7").prerelease, "beta.2");
});

test("rejects invalid package versions", () => {
  for (const version of ["1", "1.0", "01.0.0", "1.02.3", "v1.2.3", "1.2.3-", "1.2.3-01"]) {
    assert.throws(() => parsePackageVersion(version), /valid SemVer/);
  }
});

test("derives and enforces the exact release tag", () => {
  assert.equal(expectedReleaseTag("0.1.0"), "v0.1.0");
  assert.equal(validateReleaseTag("0.1.0", "v0.1.0").tag, "v0.1.0");
  assert.throws(() => validateReleaseTag("0.1.0", "v0.1.1"), /must exactly match/);
  assert.throws(() => validateReleaseTag("0.1.0", "0.1.0"), /must exactly match/);
});

test("marks SemVer prereleases explicitly", () => {
  assert.equal(validateReleaseTag("0.2.0-beta.1", "v0.2.0-beta.1").isPrerelease, true);
  assert.equal(validateReleaseTag("0.2.0", "v0.2.0").isPrerelease, false);
});
