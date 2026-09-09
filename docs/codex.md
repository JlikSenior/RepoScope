# Codex setup

RepoScope supports Codex as a first-class project-scoped MCP integration.

## Install

From the repository root:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main install codex
```

Or target another repository explicitly:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main install codex --project /path/to/project
```

The first project install on a machine ensures one fixed local RepoScope runtime exists. Later project installs reuse that runtime instead of creating a per-project runtime copy.

The adapter resolves the canonical absolute repository root and writes only two RepoScope-managed sections:

```text
<project>/
  .codex/
    config.toml
  AGENTS.md
```

Existing project content in both files is preserved.

## MCP configuration

RepoScope maintains a marked section in `.codex/config.toml`:

```toml
# >>> RepoScope managed MCP >>>
[mcp_servers.reposcope]
command = "node"
args = ["/path/to/reposcope/runtime/current/node_modules/reposcope/dist/bin.mjs", "mcp", "--project", "/absolute/path/to/project"]
# <<< RepoScope managed MCP <<<
```

The runtime entry is shared across projects. The `--project` argument is intentionally project-specific: it gives each repository a distinct MCP startup identity and hard-binds the RepoScope process to that canonical root. Two repositories with the same final directory name but different paths therefore remain isolated.

Normal Codex MCP startup no longer runs `npx`, fetches the GitHub package, or rebuilds RepoScope. The initial `npx ... install codex` command is only the bootstrap path used to ensure the local runtime exists and write the Adapter configuration.

If `.codex/config.toml` already contains an unmanaged `[mcp_servers.reposcope]` table, the installer refuses to overwrite it. Resolve that conflict manually, then rerun the installer.

Repeated installs replace only the marked RepoScope block, so updating RepoScope does not duplicate the MCP table or overwrite unrelated Codex settings.

## AGENTS.md guidance

RepoScope also maintains a marked guidance block in the repository `AGENTS.md`:

```text
<!-- >>> RepoScope managed guidance >>> -->
...
<!-- <<< RepoScope managed guidance <<< -->
```

The block instructs Codex to use RepoScope for repository localization/read/context acquisition, prefer ranged reads, avoid silent native broad-search bypass, preserve one task `sessionId`, use evidence-driven investigation, and finish the session.

Repository-owned guidance before or after the managed block is left unchanged. Reinstalling RepoScope updates only the managed section.

## Runtime/state isolation

The Codex adapter uses the same project-bound local Runtime launch specification as the Cursor adapter. One Runtime binary is shared, while RepoScope runtime state remains outside the repository under the path-derived per-project state directory.

Project-bound active sessions are recovered only from that project's state directory. A bound RepoScope process rejects scan/search/session-start attempts aimed at another project.

Inspect or refresh the fixed local Runtime with:

```bash
reposcope runtime status
reposcope runtime install
```

See [`runtime.md`](runtime.md) for Runtime location, staging/update, and npm-cache behavior.
