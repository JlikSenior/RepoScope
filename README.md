# RepoScope

RepoScope is a local repository exploration layer for AI coding agents. It lets an agent search and read only the code it needs, while enforcing token budgets and measuring how much repository context is actually delivered.

The core is intentionally AI-provider agnostic: the agent does the reasoning; RepoScope handles repository boundaries, search, reads, context budgets, deduplication, and observability.

## Current status

Early MVP. The read/exploration path works; write/edit tools are not enabled yet.

## Requirements

- Node.js 20+
- npm
- [ripgrep (`rg`)](https://github.com/BurntSushi/ripgrep) available on `PATH`

On Ubuntu/Debian:

```bash
sudo apt install ripgrep
```

## Install

```bash
npm install
npm run typecheck
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

For agent integrations, prefer MCP because it is read-only by default and does not need to write these files.

## MCP server

Start the stdio MCP server:

```bash
npm run mcp
```

Current tools:

| Tool | Purpose |
| --- | --- |
| `repo_session_start` | Start a task-level token budget and estimate repository size |
| `repo_session_status` | Inspect remaining budget, reads, events, and delivery metrics |
| `repo_search` | Search the repository with ripgrep and return a bounded ranked result set |
| `repo_read` | Read explicit repository files under per-call and task-level budgets |
| `repo_context` | Build a bounded context packet, avoiding files already delivered in the session |

### Intended agent loop

1. `repo_session_start`
2. Agent derives a few search terms from the user's task
3. `repo_search`
4. `repo_read` the most relevant files
5. Agent reasons about the code and repeats search/read only when needed
6. `repo_session_status` to inspect budget and exploration efficiency

The agent should not request the whole repository by default.

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
npm run typecheck
npm run mcp:test
```

`mcp:test` is currently an integration harness and expects the local test fixture used during MVP development. It will be replaced by self-contained automated tests.

## Next milestones

- Self-contained automated integration tests
- Faster repository/session metadata caching
- Better search ranking without increasing context size
- Session completion reports and cost-per-task metrics
- Safe write/apply-patch/test tools for coding agents
