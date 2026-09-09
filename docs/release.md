# Release policy

RepoScope uses `package.json` as the single source of truth for the product/package version.

## Version and tag contract

A release tag must be exactly:

```text
v<package.json version>
```

Examples:

```text
package.json 0.1.0        -> v0.1.0
package.json 0.2.0-beta.1 -> v0.2.0-beta.1
```

`scripts/release-policy.mjs` validates that the package version is valid SemVer and that a supplied release tag matches it exactly. `npm run check` runs the package-version validation on every normal CI run.

Release tags must point to commits already contained in `main`. The release workflow rejects a tag created from an unmerged branch.

## Release workflow

Pushing a `v*` tag runs `.github/workflows/release.yml`.

The workflow:

1. checks out full Git history;
2. verifies the tagged commit is contained in `main`;
3. verifies the tag equals `v<package version>`;
4. runs the full RepoScope validation suite;
5. creates the npm package tarball with `npm pack`;
6. creates a GitHub Release and attaches that exact tarball.

A GitHub Release is therefore produced only after the same validation gate used by normal development CI.

## Runtime source channels

RepoScope currently supports two intentional GitHub source modes:

- **Development channel:** `github:JlikSenior/RepoScope#main`. This is a moving ref. Runtime revision checks can report `update_available` when `main` advances.
- **Pinned release:** `github:JlikSenior/RepoScope#vX.Y.Z`. This is an immutable release ref. It is reproducible, but because the source itself does not move, `reposcope runtime check` will remain `current`; moving to a newer pinned release is an explicit source change.

There is deliberately no synthetic floating `stable` branch/tag. A floating alias would weaken the invariant that release tags are immutable and would add another stateful ref to maintain.

## npm publication gate

The repository is still marked `private: true` in `package.json`, so the release workflow does **not** publish to the public npm registry yet.

Public npm publication stays gated until the package namespace/ownership and CI authentication model are explicitly chosen. The release workflow is intentionally safe before those external registry prerequisites exist: it produces a validated GitHub Release tarball without pretending npm publication is configured.

When npm publication is enabled later in M3, the registry version must use the same package version and release tag contract defined here rather than introducing a second version source.

## Maintainer release steps

1. Change `package.json` version in a normal PR together with any release-specific documentation.
2. Merge only after normal CI is green.
3. Create `v<version>` on the resulting `main` commit and push the tag.
4. Let the Release workflow validate, pack, and create the GitHub Release.

Do not create release tags from feature branches or reuse an existing release version for different code.
