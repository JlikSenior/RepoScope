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
        ...
```

`runtime.json` records the package source, package version, install timestamp, and stable runtime entry path.

## Normal Agent startup

After adapter installation, Cursor and Codex launch the same local runtime directly:

```text
node <runtime-root>/current/node_modules/reposcope/dist/bin.mjs mcp --project <canonical-project-root>
```

Normal MCP startup therefore does not invoke `npx`, does not contact GitHub, does not run npm `prepare`, and does not create a fresh npm package installation for each Agent process.

The runtime binary is shared, while `--project <canonical-project-root>` and RepoScope's path-derived state directories keep project execution and active state isolated.

## Install/update lifecycle

Inspect the installed runtime with:

```bash
reposcope runtime status
```

Install or refresh the default runtime source with:

```bash
reposcope runtime install
```

A different package source can be supplied explicitly for validation or development:

```bash
reposcope runtime install --source <package-spec-or-tarball>
```

Runtime replacement is staged and validated before `current` is switched. If staging/validation fails, the previously installed runtime remains available.

## npm cache behavior

Runtime installation uses a dedicated temporary npm cache under the RepoScope runtime root and removes it when installation completes. This keeps Runtime installation artifacts out of RepoScope's normal project-state directories and avoids using npm's shared cache for the internal Runtime install operation.

The one-time outer bootstrap command (`npx ... install ...`) is still an npm/npx operation and may use npm's normal cache. Once the fixed runtime exists, normal Cursor/Codex MCP starts do not use npx.

## Adapter configuration

Cursor and Codex share the same runtime launch abstraction. The Agent-specific files differ, but both point at the same runtime entry:

```text
Cursor → .cursor/mcp.json
Codex  → .codex/config.toml
```

Each project configuration still includes its own canonical `--project` argument, so two same-named repositories can share one Runtime binary without sharing MCP identity or project state.
