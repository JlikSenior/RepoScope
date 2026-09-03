# RepoScope

RepoScope is a **local-first repository context and change-control layer for AI coding agents**. It lets a local Agent search and read only the code it needs, enforce task-level token budgets, measure context delivery, make guarded Git patch edits, run repository-approved verification commands, and finish each task with a truthful report.

The core is intentionally AI-provider agnostic: Claude Code, Codex, or another local MCP-capable Agent does the reasoning; RepoScope handles repository boundaries, search, reads, context budgets, deduplication, safe writes, verification commands, and observability.

## Current status

Early MVP. The local stdio MCP path supports a complete guarded coding loop: search → read → edit → verify → inspect diff → finish session.

## Requirements

- Node.js 20+
- npm
- Git
- [ripgrep (`rg`)](https://github.com/BurntSushi/ripgrep) available on `PATH`

On Ubuntu/Debian:

```bash
sudo apt install ripgrep
```

## Install

```bash
npm install
npm run check
```

## Local MCP server

RepoScope is designed to be spawned locally by an MCP-capable coding Agent over **stdio**:

```bash
npm run mcp
```

There is no network transport required for the normal workflow.

### MCP tools

| Tool | Purpose |
| --- | --- |
| `repo_session_start` | Start a task-level source-token budget and estimate repository size |
| `repo_search` | Search with ripgrep and return a bounded ranked result set |
| `repo_read` | Read explicit repository files under per-call and task-level budgets |
| `repo_context` | Build a bounded context packet while avoiding already-delivered source |
| `repo_status` | Inspect Git working-tree status |
| `repo_apply_patch` | Apply a guarded text patch after existing target files have been read |
| `repo_diff` | Inspect the current Git diff under an output-token budget |
| `repo_commands` | List verification commands approved by the repository |
| `repo_run` | Run one approved command with timeout and output-token limits |
| `repo_session_status` | Inspect active or finished session metrics and history |
| `repo_session_finish` | Finish and lock the task, producing a final outcome/verification report |

### Intended local Agent loop

1. `repo_session_start`
2. Agent derives a few search terms from the user's task
3. `repo_search`
4. `repo_read` only the most relevant files
5. Agent reasons and repeats search/read only when needed
6. `repo_apply_patch`
7. `repo_commands`
8. `repo_run` tests/type checks/builds approved by the repository
9. Agent fixes failures and reruns checks as needed
10. `repo_diff` / `repo_status`
11. `repo_session_finish`

The Agent should not request the whole repository by default.

## Session completion

`repo_session_finish` separates two concepts that must not be conflated:

- **Reported outcome**: what the Agent declares — `success`, `failed`, or `abandoned`.
- **Verification**: what RepoScope can objectively infer from the final `repo_run` — `passed`, `failed`, or `not_run`.

For example, an Agent may report `success` while verification is `not_run`. RepoScope preserves both facts rather than treating the task as verified.

The final report includes changed files, token metrics, reads/writes, command runs, failed runs, and the last verification result. Finishing a session locks it: normal search/read/write/run tools cannot continue using that session. `repo_session_status` remains available for historical inspection.

## Safe write policy

Write tools deliberately do **not** provide arbitrary filesystem access.

`repo_apply_patch` currently enforces:

- `targetPath` must be the Git repository root.
- A valid active task session is required.
- Existing files touched by the patch must have been read in that same session first.
- New text files may be introduced without a prior read.
- Patch paths cannot be absolute, escape with `..`, or target `.git`.
- Binary patches are rejected.
- `git apply --check` must succeed before the patch is applied.
- Modified files invalidate their old read state so the Agent can reread the new version.
- `.reposcope.json` is a protected policy file and cannot be changed through `repo_apply_patch`.

`repo_diff` is output-budgeted so a large working-tree diff cannot unexpectedly consume Agent context.

## Allowlisted test/build execution

RepoScope does **not** expose arbitrary shell commands. A repository opts into verification entrypoints with a root-level `.reposcope.json` file:

```json
{
  "commands": {
    "test": ["npm", "test"],
    "check": ["npm", "run", "check"],
    "typecheck": ["npm", "run", "typecheck"]
  }
}
```

The format is language-independent. Another repository could use:

```json
{
  "commands": {
    "test": ["pytest", "-q"],
    "build": ["cargo", "build", "--locked"]
  }
}
```

Safety model:

- Agent chooses only an approved **command name**.
- Executable and argv come entirely from `.reposcope.json`.
- Agent cannot append shell arguments.
- Commands run with `shell: false` at the Git repository root.
- Executable entries containing paths such as `../tool` or `./script` are rejected.
- Timeout is capped at 5 minutes.
- Captured output and MCP output are bounded.
- Non-zero exits are returned as diagnostic output so the Agent can fix the code.
- `.reposcope.json` cannot be modified through RepoScope itself.

This is a command-selection control, **not an OS sandbox**. Approved tests/builds execute repository code with the permissions of the RepoScope process.

## Token metrics

RepoScope keeps source delivery separate from protocol delivery:

- **`usedTokens`**: source code delivered in the task session. This is the source budget.
- **`deliveredTokens`**: measured MCP response payload tokens for tracked tools.
- **`wholeRepoTokens`**: a fast file-size-based estimate of the AI-readable repository, not a billing number.

`sourceReductionPercent` compares delivered source with the estimated whole repository. `netContextReductionPercent` also includes tracked MCP response overhead.

`repo_session_status` is excluded from delivered-token accounting to avoid self-referential monitoring payloads.

## Repository boundary

RepoScope uses `rg --files`, so normal ignore rules such as `.gitignore` are respected. It also excludes common binary/resource formats and files larger than 1 MiB by default. Explicit reads must resolve to the scanned repository file set, preventing path traversal outside the repository.

## CLI

A diagnostic CLI remains available:

```bash
npm run cli -- <repo-path> "<task>" <budget-tokens> "term1,term2,term3"
```

It writes diagnostic artifacts such as `context-packet.md`, `repo-map.json`, and monitoring files into the target repository. For coding Agents, prefer the stdio MCP server.

## Development and tests

All automated tests live under `tests/`:

```bash
npm test
npm run typecheck
npm run check
```

`npm run check` is the CI gate. Coverage includes repository boundaries, token budgets, cross-tool deduplication, guarded patches, post-write rereads, allowlisted command execution, protected policy files, session completion/locking, and an end-to-end **stdio MCP** lifecycle test.

## Next milestones

- Better search ranking without increasing context size
- Faster repository/session metadata caching
- Persistent session/task history
- Aggregate cost-per-successful-task and localization-quality metrics
- Packaging and simple local-Agent installation/configuration
