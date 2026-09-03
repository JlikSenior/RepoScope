# RepoScope

RepoScope is a **local-first Repository Context Gateway for AI coding agents**.

Its job is not to understand code or replace the Agent. Claude Code, Codex, or another local MCP-capable Agent does the reasoning. RepoScope controls how that Agent touches the repository so it can complete a task with less irrelevant source context, a hard task-level budget, deduplication, and measurable delivery metrics.

The product hypothesis is simple:

> **Keep verified task success close to the normal Agent baseline while materially reducing repository/model context.**

## Product boundary

RepoScope Core is intentionally:

- zero-AI
- provider-independent
- IDE-independent
- language-independent
- local-first
- Agent-driven
- budget-enforced
- observable

Core responsibilities:

```text
Repository boundary
Search
Read
Context delivery
Task-level token budget
Cross-tool deduplication
Session metrics
```

The Agent remains responsible for understanding the task, generating search terms, deciding which files matter, reasoning about code, and choosing the next exploration step.

## Local MCP server

RepoScope is designed to be spawned locally by a coding Agent over **stdio**:

```bash
npm install
npm run mcp
```

There is no network transport required for the normal workflow.

### Core context tools

| Tool | Purpose |
| --- | --- |
| `repo_session_start` | Start a task-level source-token budget and estimate repository size |
| `repo_search` | Search with ripgrep and return a bounded ranked result set |
| `repo_read` | Read explicit repository files under per-call and task-level budgets |
| `repo_context` | Build a bounded context packet while avoiding already-delivered source |
| `repo_session_status` | Inspect active or finished session metrics/history |
| `repo_session_finish` | Finish and lock the task with a final outcome/verification report |

The core exploration loop is:

```text
start
  -> search
  -> read
  -> Agent reasons
  -> search/read only when necessary
  -> finish
```

The Agent should not request the whole repository by default.

## Integration utilities

RepoScope also includes guarded utilities so the context layer can be evaluated inside real coding tasks:

| Tool | Purpose |
| --- | --- |
| `repo_apply_patch` | Apply a guarded text patch after existing target files have been read |
| `repo_status` | Inspect Git working-tree status |
| `repo_diff` | Inspect the current Git diff under an output-token budget |
| `repo_commands` | List verification commands approved by the repository |
| `repo_run` | Run one approved verification command with timeout/output limits |

These utilities are **not the core product value**. They exist to support realistic experiments such as:

```text
search -> read -> edit -> verify -> inspect -> finish
```

RepoScope is not intended to become a coding Agent, IDE, shell Agent, CI system, language server, or general sandbox.

## Session completion

`repo_session_finish` keeps Agent claims separate from objective verification:

- **Reported outcome**: `success`, `failed`, or `abandoned`.
- **Verification**: derived from the final approved `repo_run` as `passed`, `failed`, or `not_run`.

An Agent can therefore report `success` while RepoScope records `verification: not_run` or `failed`. The final report also contains changed files, source/delivery metrics, exploration counts, writes, and command runs.

Finishing a session locks it against further normal search/read/write/run operations. `repo_session_status` remains available for historical inspection.

## Token metrics

RepoScope deliberately separates different measurements:

- **`usedTokens`** — source code delivered during the task; this is the enforced source budget.
- **`deliveredTokens`** — measured MCP response payload tokens for tracked tools.
- **`wholeRepoTokens`** — fast file-size-based estimate of the AI-readable repository; this is not a provider billing number.

Derived metrics include:

```text
sourceReductionPercent
netContextReductionPercent
toolOverheadTokens
toolOverheadPercent
```

Reduction alone is not enough to validate the product. It must be evaluated together with verified task success.

## Benchmarking the product hypothesis

RepoScope includes a small benchmark report harness for paired A/B experiments.

Run the **same Agent** on the **same task and repository commit**:

```text
A: baseline Agent behavior without RepoScope context control
B: the same Agent using RepoScope
```

Record each run as one JSONL object, then generate the report:

```bash
npm run benchmark:report -- ./benchmark-results.jsonl
```

The report compares:

- reported success rate
- **verified success rate**
- files read
- repository source tokens
- provider-observed model input/output tokens when available
- duration/tool calls when available
- paired context reductions

A/B pairing is strict: `repository + commit + taskId + agent + trial` must match, with exactly one baseline and one RepoScope run. Missing or duplicated arms are reported and excluded from reduction calculations.

See [`docs/benchmark.md`](docs/benchmark.md) for the schema and experimental protocol.

The first executable pilot lives in [`benchmarks/pilot/`](benchmarks/pilot/README.md). It replays five real problems from the original RepoScope prototype against a fixed historical commit, with independent external verifiers and a strict baseline-vs-RepoScope procedure.

## Safe write policy

`repo_apply_patch` deliberately does not provide arbitrary filesystem access:

- `targetPath` must be the Git repository root.
- A valid active task session is required.
- Existing files must have been read in that session before modification.
- New text files may be introduced.
- Absolute paths, `..`, `.git`, binary patches, and unsupported quoted paths are rejected.
- `git apply --check` must pass before application.
- Modified files invalidate stale read state so the Agent can reread them.
- `.reposcope.json` is protected from RepoScope patch operations.

## Approved test/build commands

RepoScope does not expose arbitrary shell strings. Repositories may opt into verification entrypoints through `.reposcope.json`:

```json
{
  "commands": {
    "test": ["npm", "test"],
    "check": ["npm", "run", "check"]
  }
}
```

The format is language-independent; another project could allow `pytest`, `cargo`, or `cmake` commands.

The Agent chooses only the command **name**. Executable and argv come from repository-controlled configuration, commands run with `shell: false`, timeout is capped, and returned output is bounded.

This is command-selection control, **not an OS sandbox**. Approved tests/builds execute repository code with the permissions of the RepoScope process.

## Repository boundary

RepoScope uses `rg --files`, respects normal ignore rules such as `.gitignore`, excludes common binary/resource formats and files over 1 MiB by default, and only allows explicit reads from the scanned repository set.

## Development

Requirements:

- Node.js 20+
- npm
- Git
- `ripgrep` (`rg`) on `PATH`

Run the full validation suite:

```bash
npm run check
```

All automated tests live under `tests/`. The suite includes repository boundaries, source budgets, deduplication, guarded writes, verification commands, session lifecycle, benchmark calculations, Pilot manifest/verifier checks, and a real end-to-end **stdio MCP** lifecycle test.

## Current development priority

The MVP already has enough tools to run real coding experiments. The priority is now evidence, not feature count:

1. run paired baseline vs RepoScope tasks on real repositories
2. measure verified success and context cost together
3. improve localization/search only when benchmark evidence shows it is needed
4. optimize performance only where real task traces justify it
