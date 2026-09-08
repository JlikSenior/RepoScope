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
command = "npx"
args = ["-y", "--prefer-online", "github:JlikSenior/RepoScope#main", "mcp", "--project", "/absolute/path/to/project"]
# <<< RepoScope managed MCP <<<
```

The `--project` argument is intentional. It gives each repository a distinct MCP startup identity and hard-binds the RepoScope process to that canonical root. Two repositories with the same final directory name but different paths therefore remain isolated.

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

The Codex adapter uses the same project-bound MCP launch specification as the Cursor adapter. RepoScope runtime state remains outside the repository under the path-derived per-project state directory.

Project-bound active sessions are recovered only from that project's state directory. A bound RepoScope process rejects scan/search/session-start attempts aimed at another project.

## Current runtime bootstrap

The adapter currently launches RepoScope through:

```text
npx -y --prefer-online github:JlikSenior/RepoScope#main
```

That keeps installation path-free while the project is private, but it still uses npm/npx's shared package cache. Replacing repeated npx bootstrap with a single installed local RepoScope runtime is a separate productization step; the Cursor and Codex adapters deliberately share one launch-spec abstraction so that future runtime change can apply to both without changing RepoScope Core or its MCP tool schema.
