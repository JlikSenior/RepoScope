# Doctor and cleanup

RepoScope provides a read-only diagnostic command and a deliberately narrow cleanup command.

## Doctor

Run from a repository root:

```bash
reposcope doctor
```

Or diagnose a specific project and Agent adapter:

```bash
reposcope doctor --project /path/to/project
reposcope doctor --agent cursor
reposcope doctor --agent codex
```

`doctor` emits JSON and never repairs or rewrites project configuration.

Core checks include:

- Node.js 20+;
- Git availability and whether the target is the Git repository root;
- fixed local RepoScope Runtime validity and entry path;
- RepoScope state-root writability and path-derived project identity;
- `.reposcope.json` validation using the same command-policy parser as `repo_run`;
- ripgrep availability.

Ripgrep is optional. Missing `rg` is a warning because RepoScope has a Git/Node fallback.

When `--agent cursor` is supplied, doctor also verifies that project `.cursor/mcp.json` points at the installed local Runtime with the correct canonical `--project` binding and checks the RepoScope rule/Skills.

When `--agent codex` is supplied, doctor verifies the RepoScope-managed MCP block in `.codex/config.toml`, its local Runtime/project binding, and the RepoScope-managed `AGENTS.md` guidance block.

Exit behavior:

- `ok` or `warning`: exit 0;
- `error`: exit 1.

Examples of errors are a missing/corrupt fixed Runtime, a non-Git-root target, invalid `.reposcope.json`, or an explicitly requested Agent adapter that is missing/stale.

## Cleanup

Run:

```bash
reposcope cleanup
reposcope cleanup --project /path/to/project
```

Cleanup is intentionally conservative. It may remove only:

- stale active Session checkpoints older than seven days for the selected project;
- stale active atomic temporary files older than one hour for the selected project;
- matching legacy active locators when a stale active checkpoint is removed;
- stale Runtime installer directories named `.install-*`, `.npm-cache-*`, or `.previous-*` older than one hour.

Cleanup does **not** remove:

- the installed Runtime `current/` directory;
- `runtime.json`;
- finished Session history used by `project-report`;
- another project's state;
- Cursor/Codex project configuration or guidance.

Long-term finished-history retention/compaction remains a separate state-lifecycle policy.
