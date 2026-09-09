# Project Agent uninstall

RepoScope project adapters can be removed without deleting the shared local Runtime or project observability history.

## Cursor

```bash
reposcope uninstall cursor
reposcope uninstall cursor --project /path/to/project
```

This removes only RepoScope-owned Cursor integration:

- `mcpServers.reposcope` from `.cursor/mcp.json`;
- `.cursor/rules/reposcope.mdc`;
- `.cursor/skills/reposcope/`;
- `.cursor/skills/reposcope-benchmark/`.

Other MCP servers, Cursor config fields, Rules, and Skills are preserved.

## Codex

```bash
reposcope uninstall codex
reposcope uninstall codex --project /path/to/project
```

This removes only the RepoScope-managed blocks from:

- `.codex/config.toml`;
- `AGENTS.md`.

User-owned TOML settings, other MCP servers, and repository guidance outside those blocks are preserved.

## Shared Runtime and state

Agent uninstall deliberately does not remove:

- the fixed local RepoScope Runtime;
- another project's Cursor/Codex adapter;
- active or finished RepoScope Session state;
- `project-report` history.

Use `reposcope cleanup` for bounded stale temporary-state cleanup. Runtime removal and finished-history retention are separate lifecycle policies.

Uninstall is idempotent: running it again when the RepoScope project adapter is already absent succeeds without modifying unrelated files.
