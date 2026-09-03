# RepoScope

RepoScope is a local repository context and change-control layer for AI coding agents. It lets an agent search and read only the code it needs, enforce task-level token budgets, measure context delivery, and make guarded Git patch edits.

The core is intentionally AI-provider agnostic: the agent does the reasoning; RepoScope handles repository boundaries, search, reads, context budgets, deduplication, observability, and safe write policy.

## Current status

Early MVP. Read/exploration works on real repositories, guarded text-patch writes are available behind a session, and the same MCP tool surface can be served over stdio or loopback HTTP.

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

## CLI

```bash
npm run cli -- <repo-path> "<task>" <budget-tokens> "term1,term2,term3"
```

Example:

```bash
npm run cli -- ../my-project "payment fails after checkout" 2000 "payment,billing,checkout"
```

The CLI currently writes these diagnostic files into the target repository:

- `context-packet.md`
- `repo-map.json`
- `monitoring-log.jsonl`
- `monitoring-summary.json`

For agent integrations, prefer MCP. The MCP flow does not need these diagnostic files.

## MCP server

### stdio

For local MCP hosts that spawn the server process directly:

```bash
npm run mcp
```

### Loopback HTTP

For remote/tunnel-based MCP hosts, start the Streamable HTTP endpoint:

```bash
npm run mcp:http
```

Defaults:

- MCP endpoint: `http://127.0.0.1:8787/mcp`
- Health endpoint: `http://127.0.0.1:8787/health`
- Override the port with `REPOSCOPE_PORT=<port>`.

The HTTP server intentionally binds only to `127.0.0.1`; do not expose it directly to the public internet. For ChatGPT on the web, place a trusted secure MCP tunnel in front of this local endpoint.

Both stdio and HTTP use the same MCP server factory, so their tool definitions cannot drift apart.

Current tools:

| Tool | Purpose |
| --- | --- |
| `repo_session_start` | Start a task-level source-token budget and estimate repository size |
| `repo_session_status` | Inspect remaining budget, reads, writes, events, and delivery metrics |
| `repo_search` | Search with ripgrep and return a bounded ranked result set |
| `repo_read` | Read explicit repository files under per-call and task-level budgets |
| `repo_context` | Build a bounded context packet, avoiding source already delivered in the session |
| `repo_status` | Inspect Git working-tree status for the session repository |
| `repo_apply_patch` | Apply a validated text patch after existing target files have been read |
| `repo_diff` | Inspect the current Git diff under an output-token budget |

### Intended coding loop

1. `repo_session_start`
2. Agent derives a few search terms from the user's task
3. `repo_search`
4. `repo_read` the most relevant files
5. Agent reasons and repeats search/read only when needed
6. `repo_apply_patch` to edit code
7. `repo_diff` and `repo_status` to review the change
8. `repo_session_status` to inspect budget and exploration efficiency

The agent should not request the whole repository by default.

## Safe write policy

Write tools deliberately do **not** provide arbitrary filesystem or shell access.

`repo_apply_patch` currently enforces:

- `targetPath` must be the Git repository root.
- A valid task session is required.
- Existing files touched by the patch must have been read in that same session first.
- New text files may be introduced without a prior read.
- Patch paths cannot be absolute, escape with `..`, or target `.git`.
- Binary patches are rejected.
- `git apply --check` must succeed before the patch is applied.
- Modified files invalidate their old read state so the agent can reread the new version.

`repo_diff` is output-budgeted so a large working-tree diff cannot unexpectedly consume the agent's context.

RepoScope does not yet expose arbitrary command execution. Test/build execution will be added separately with an allowlisted command policy.

## Token metrics

RepoScope keeps two different concepts separate:

- **Source tokens (`usedTokens`)**: source code actually delivered during a session. This is the task budget.
- **Delivered tokens (`deliveredTokens`)**: measured MCP payload tokens emitted by tracked tools, including protocol/metadata overhead.

`wholeRepoTokens` is intentionally a **fast estimate** based on the AI-readable file set and file sizes rather than full-repository tokenization. Selected source and MCP payloads use a real tokenizer.

`sourceReductionPercent` compares source delivered vs. estimated whole-repo source. `netContextReductionPercent` also considers tracked MCP payload overhead.

`repo_session_status` is currently excluded from `deliveredTokens` to avoid self-referential monitoring payloads.

## Repository boundary

RepoScope uses `rg --files`, so it respects normal ignore rules such as `.gitignore`. It also excludes common binary/resource formats and files larger than 1 MiB by default. Requested reads must resolve to a file in the scanned repository set, preventing path traversal outside the target repository.

## Development

```bash
npm run check
```

For the current manual stdio MCP end-to-end harness:

```bash
npm run mcp:test
```

## Next milestones

- Safe allowlisted test/build execution
- Faster repository/session metadata caching
- Better search ranking without increasing context size
- Session completion reports and cost-per-successful-task metrics
- Secure MCP Tunnel / Web ChatGPT setup for local repository takeover
