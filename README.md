# RepoScope

RepoScope is a local repository context and change-control layer for AI coding agents. It lets an agent search and read only the code it needs, enforce task-level token budgets, measure context delivery, make guarded Git patch edits, and run repository-approved verification commands.

The core is intentionally AI-provider agnostic: the agent does the reasoning; RepoScope handles repository boundaries, search, reads, context budgets, deduplication, observability, safe write policy, and command execution policy.

## Current status

Early MVP. Read/exploration works on real repositories, guarded text-patch writes are available behind a session, allowlisted verification commands can be executed without arbitrary shell access, and the same MCP tool surface can be served over stdio or loopback HTTP.

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
| `repo_session_status` | Inspect remaining budget, reads, writes, command runs, events, and delivery metrics |
| `repo_search` | Search with ripgrep and return a bounded ranked result set |
| `repo_read` | Read explicit repository files under per-call and task-level budgets |
| `repo_context` | Build a bounded context packet, avoiding source already delivered in the session |
| `repo_status` | Inspect Git working-tree status for the session repository |
| `repo_apply_patch` | Apply a validated text patch after existing target files have been read |
| `repo_diff` | Inspect the current Git diff under an output-token budget |
| `repo_commands` | List command names explicitly allowlisted by the repository |
| `repo_run` | Run one allowlisted command with a timeout and output-token budget |

### Intended coding loop

1. `repo_session_start`
2. Agent derives a few search terms from the user's task
3. `repo_search`
4. `repo_read` the most relevant files
5. Agent reasons and repeats search/read only when needed
6. `repo_apply_patch` to edit code
7. `repo_commands` to discover repository-approved verification commands
8. `repo_run` to execute tests, type checks, builds, or other approved checks
9. Agent uses failures to revise the code and rerun checks
10. `repo_diff` and `repo_status` to review the final change
11. `repo_session_status` to inspect budget and exploration efficiency

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

## Allowlisted test/build execution

RepoScope still does **not** expose arbitrary command execution. A repository opts into executable checks with a root-level `.reposcope.json` file:

```json
{
  "commands": {
    "test": ["npm", "test"],
    "check": ["npm", "run", "check"],
    "typecheck": ["npm", "run", "typecheck"]
  }
}
```

The format is language-independent. For another repository it can just as easily contain commands such as:

```json
{
  "commands": {
    "test": ["pytest", "-q"],
    "build": ["cargo", "build", "--locked"]
  }
}
```

The safety model is intentionally narrow:

- The Agent chooses only an allowlisted **command name** such as `test` or `build`.
- The executable and argument vector come entirely from `.reposcope.json`; the Agent cannot supply or append shell arguments.
- Commands run with `shell: false` in the Git repository root.
- Executable entries containing paths such as `../tool` or `./script` are rejected; use an executable available on `PATH`.
- Each run has a configurable timeout capped at 5 minutes.
- Captured process output is bounded and the MCP response has an explicit token budget.
- Non-zero test/build exits are returned to the Agent as diagnostic output rather than being hidden as tool errors.
- Session metrics record total command runs and failed runs.

This gives an Agent enough authority to verify its code while keeping general shell execution out of the tool surface.

## Token metrics

RepoScope keeps two different concepts separate:

- **Source tokens (`usedTokens`)**: source code actually delivered during a session. This is the task budget.
- **Delivered tokens (`deliveredTokens`)**: measured MCP payload tokens emitted by tracked tools, including protocol/metadata overhead.

`wholeRepoTokens` is intentionally a **fast estimate** based on the AI-readable file set and file sizes rather than full-repository tokenization. Selected source and MCP payloads use a real tokenizer.

`sourceReductionPercent` compares source delivered vs. estimated whole-repo source. `netContextReductionPercent` also considers tracked MCP payload overhead.

`repo_session_status` is currently excluded from `deliveredTokens` to avoid self-referential monitoring payloads.

## Repository boundary

RepoScope uses `rg --files`, so it respects normal ignore rules such as `.gitignore`. It also excludes common binary/resource formats and files larger than 1 MiB by default. Requested reads must resolve to a file in the scanned repository set, preventing path traversal outside the target repository.

## Development and tests

All automated tests live under `tests/` and are executed by the standard project entrypoints:

```bash
npm test
npm run typecheck
npm run check
```

`npm run check` is the CI gate and runs both type checking and the full automated test suite. Production source files under `src/` do not contain ad-hoc `*-test` harnesses.

Current coverage includes repository scanning/search boundaries, task budgets and cross-tool deduplication, guarded patch writes, diff/status behavior, post-write rereads, allowlisted command execution and output budgets, and the HTTP MCP transport/tool surface.

## Next milestones

- Faster repository/session metadata caching
- Better search ranking without increasing context size
- Session completion reports and cost-per-successful-task metrics
- Secure MCP Tunnel / Web ChatGPT setup for local repository takeover
