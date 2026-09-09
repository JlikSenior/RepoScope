# Local RepoScope runtime

RepoScope project adapters use one shared local runtime installation instead of bootstrapping the MCP server through `npx` on every Agent start.

## First install

The preferred project install commands are:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main install cursor
npx -y --prefer-online github:JlikSenior/RepoScope#main install codex
```

The first command on a machine bootstraps the fixed local runtime if it is not already installed. Later project-adapter installs reuse that runtime when it was installed from the same source spec.

The initial `npx` invocation is therefore a bootstrap step, not the normal MCP startup path.

## Runtime locations

Default runtime roots are:

- Linux: `$XDG_DATA_HOME/reposcope/runtime` or `~/.local/share/reposcope/runtime`
- macOS: `~/Library/Application Support/RepoScope/runtime`
- Windows: `%LOCALAPPDATA%/RepoScope/runtime`

Set `REPOSCOPE_RUNTIME_DIR` to override the runtime root.

The active runtime is stored under:

```text
<runtime-root>/
  runtime.json
  current/
    node_modules/
      reposcope/
        dist/
          bin.mjs
          build-info.json
        ...
```

`runtime.json` records the package source, package version, install timestamp, and stable runtime entry path. `dist/build-info.json` travels with the actual installed code and records the package version plus the exact Git build revision when available.

Keeping revision identity inside the installed package avoids changing the existing Runtime manifest schema and remains compatible with Runtimes installed before revision tracking existed.

## Normal Agent startup

After adapter installation, Cursor and Codex launch the same local runtime directly:

```text
node <runtime-root>/current/node_modules/reposcope/dist/bin.mjs mcp --project <canonical-project-root>
```

Normal MCP startup therefore does not invoke `npx`, does not contact GitHub, does not run npm `prepare`, and does not create a fresh npm package installation for each Agent process.

The runtime binary is shared, while `--project <canonical-project-root>` and RepoScope's path-derived state directories keep project execution and active state isolated.

## Version identity

Inspect the current CLI build and installed Runtime build without network access:

```bash
reposcope version
```

The report separates:

- CLI `packageVersion`;
- CLI `revision`;
- installed Runtime manifest;
- installed Runtime build `packageVersion` and `revision`.

While RepoScope still uses a moving private GitHub `main` source, the Git revision is the immutable build identity. Two builds may temporarily have the same package version while still being distinguishable by revision.

Older pre-revision-tracking Runtime installs remain valid. Their revision is reported as unknown rather than guessed.

## Update check

Check whether the installed Runtime matches its current source ref:

```bash
reposcope runtime check
```

For the current `github:owner/repository#ref` source form, RepoScope resolves the ref with a bounded `git ls-remote` operation and compares it with the embedded installed revision.

Possible states include:

- `current`;
- `update_available`;
- `unknown_installed_revision` for an older Runtime that needs one refresh to establish build identity;
- `source_uncheckable` when the source type is unsupported, the machine is offline, or Git credentials cannot resolve the private source;
- `runtime_missing`.

A failed/unsupported update check does not affect normal MCP startup and does not modify the Runtime.

## Install/update lifecycle

Inspect the basic installed Runtime manifest with:

```bash
reposcope runtime status
```

Force-install or refresh the default Runtime source with:

```bash
reposcope runtime install
```

A different package source can be supplied explicitly for validation or development:

```bash
reposcope runtime install --source <package-spec-or-tarball>
```

Once a Runtime is installed, update from the exact source recorded in its manifest with:

```bash
reposcope runtime update
```

`runtime update` deliberately does not rely on the old `ensure` reuse shortcut: it always stages a fresh install from the recorded source. Runtime replacement is validated before `current` is switched. If staging/validation fails, the previously installed Runtime remains available.

Because project adapters point at the stable `current/.../dist/bin.mjs` path, a successful Runtime update applies to all Cursor/Codex projects on their next MCP process start without rewriting every project adapter.

## npm cache behavior

Runtime installation/update uses a dedicated temporary npm cache under the RepoScope runtime root and removes it when installation completes. This keeps Runtime installation artifacts out of RepoScope's normal project-state directories and avoids using npm's shared cache for the internal Runtime install operation.

The one-time outer bootstrap command (`npx ... install ...`) is still an npm/npx operation and may use npm's normal cache. Once the fixed runtime exists, normal Cursor/Codex MCP starts do not use npx.

## Adapter configuration

Cursor and Codex share the same runtime launch abstraction. The Agent-specific files differ, but both point at the same runtime entry:

```text
Cursor → .cursor/mcp.json
Codex  → .codex/config.toml
```

Each project configuration still includes its own canonical `--project` argument, so two same-named repositories can share one Runtime binary without sharing MCP identity or project state.

Release tags and GitHub Release artifacts now follow the version contract in [`release.md`](release.md). The moving `main` ref remains the development/update-aware source, while exact `vX.Y.Z` refs are reproducible pinned releases. Public npm publication remains a separate M3 gate until registry namespace/ownership and CI authentication are explicitly configured.
