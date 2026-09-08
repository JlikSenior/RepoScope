# RepoScope

RepoScope is a **local-first Repository Context Gateway for AI coding agents**.

Its job is not to understand code or replace the Agent. Claude Code, Codex, Cursor, or another local MCP-capable Agent does the reasoning. RepoScope controls how that Agent touches the repository so it can complete a task with less irrelevant source context, a hard task-level budget, deduplication, and measurable delivery metrics.

The product hypothesis is simple:

> **Keep verified task success close to the normal Agent baseline while materially reducing repository/model context.**

## Quick start with Cursor

During testing, install RepoScope only in the project where you want to evaluate it. Run this from that project root:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-install
```

By default this command is **project-scoped**. It:

- adds RepoScope to `<project>/.cursor/mcp.json`,
- hard-binds that MCP startup command to the project's canonical absolute path,
- installs `reposcope` and `reposcope-benchmark` under `<project>/.cursor/skills/`,
- preserves existing project MCP servers,
- does not modify your global Cursor configuration.

After installation, restart Cursor or reload MCPs. The configured MCP command follows the GitHub `main` branch and uses npm's fresh-cache check, so RepoScope updates do not require changing a local project path.

The repository is currently private, so the machine running Cursor must already have GitHub Git access configured.

Global installation remains available explicitly with `cursor-install --global`, but project scope is the recommended mode while RepoScope is being tested.

See [`docs/cursor.md`](docs/cursor.md) for details.

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

The Agent remains responsible for understanding the task, generating search terms, deciding which files matter, reasoning about code, editing code, and choosing the next exploration step.

## Local MCP server

RepoScope is designed to be spawned locally over **stdio**. The packaged executable defaults to unbound MCP mode:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main
```

A single-project MCP process can be hard-bound explicitly:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main mcp --project /absolute/path/to/project
```

Project-scoped `cursor-install` writes this bound form automatically.

For RepoScope development from a checkout:

```bash
npm install
npm run mcp
```

There is no network transport required for the normal workflow.

### Core context tools

| Tool | Purpose |
| --- | --- |
| `repo_session_start` | Start a task-level source-token budget and estimate repository size |
| `repo_search` | Search and return a bounded ranked result set with match lines |
| `repo_read` | Read explicit repository files/ranges under per-call and task-level budgets |
| `repo_context` | Build a bounded range-aware context packet while avoiding already-delivered source |
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

## Multi-project state isolation

Cursor exposure scope, MCP process identity, and RepoScope runtime-state scope are separate concerns.

With project-scoped installation, each workspace gets a `.cursor/mcp.json` entry containing its **canonical absolute project root** as `mcp --project <root>`. Therefore two repositories with the same folder/repository name still have different MCP startup identities when their paths differ.

The bound RepoScope process also enforces that root internally. Repository scanning/searching and session creation for another project are rejected even if a host accidentally routes the request to the wrong RepoScope process.

Runtime state is isolated independently. Each repository is canonicalized with `realpath` and assigned a stable id derived from the canonical path. RepoScope-owned diagnostic/state files live outside the target repository under a per-project directory:

```text
<RepoScope state root>/
  projects/
    <project-id-A>/
      project.json
      active/
      sessions/
      cli/
        context-packet.md
        repo-map.json
        monitoring-log.jsonl
        monitoring-summary.json
    <project-id-B>/
      ...
```

Two repositories with the same folder name still receive different project ids. Different symlink paths to the same repository resolve to the same project id.

Default state roots:

- Linux: `$XDG_STATE_HOME/reposcope` or `~/.local/state/reposcope`
- macOS: `~/Library/Application Support/RepoScope/state`
- Windows: `%LOCALAPPDATA%/RepoScope/state`

Set `REPOSCOPE_STATE_DIR` to override the entire state root.

Project-bound MCP processes recover active sessions directly from their own project state directory and do **not** create new state-root-wide active-session locator files. The shared locator path remains only for unbound/global backward compatibility.

On bound MCP startup, RepoScope removes abandoned active checkpoints older than seven days and incomplete atomic temporary files older than one hour **from that project only**. Finished session reports are retained because they feed observability and `project-report`; finished-history retention/compaction is a separate policy.

Every session has a UUID and is bound to its canonical target repository. A session created for project A cannot be recovered or used by a project-bound MCP process for project B.

## Agent Skills

RepoScope ships two portable Skills:

- `skills/reposcope/SKILL.md` — normal coding workflow. It makes RepoScope the repository search/read/context gateway while leaving reasoning and editing to the Agent.
- `skills/reposcope-benchmark/SKILL.md` — explicit benchmark mode with stricter no-fallback rules.

Project-scoped `cursor-install` copies both into `<project>/.cursor/skills/`, which Cursor discovers only for that project. Explicit `cursor-install --global` keeps the previous user-level behavior.

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

The report compares reported/verified success, files read, repository source tokens, provider-observed model tokens when available, duration/tool calls, and paired reductions.

A/B pairing is strict: `repository + commit + taskId + agent + trial` must match, with exactly one baseline and one RepoScope run. Missing or duplicated arms are excluded from reduction calculations.

See [`docs/benchmark.md`](docs/benchmark.md) for the protocol and [`benchmarks/pilot/`](benchmarks/pilot/README.md) for the first executable pilot.

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

The format is language-independent. The Agent chooses only the command name; executable and argv come from repository-controlled configuration, commands run with `shell: false`, timeout is capped, and returned output is bounded.

This is command-selection control, **not an OS sandbox**. Approved tests/builds execute repository code with the permissions of the RepoScope process.

## Repository boundary

RepoScope prefers `rg`/ripgrep for fast file listing and fixed-string search. If ripgrep is missing, RepoScope falls back to Git-aware file listing plus bounded Node search instead of failing to start. Normal ignore rules such as `.gitignore` remain respected, common binary/resource formats are excluded, files over 1 MiB are excluded by default, and explicit reads are restricted to the scanner-approved repository set.

## Packaging

The repository contains an npm `bin` entry and a production TypeScript build. Git installs use the npm `prepare` lifecycle to compile `dist/` before the executable is used.

Current zero-path package spec:

```text
github:JlikSenior/RepoScope#main
```

The same executable can later be published to the npm registry without changing the MCP interface. Registry publication is intentionally separate from the package/runtime implementation.

## Development

Requirements:

- Node.js 20+
- npm
- Git
- `ripgrep` (`rg`) is optional but recommended for faster large-repository search

Run the full validation suite:

```bash
npm run check
```

The suite includes repository boundaries, source budgets, deduplication, guarded writes, verification commands, session lifecycle, benchmark calculations, hard per-project isolation, Cursor installer tests, compiled-package MCP runtime checks, Windows smoke coverage, Pilot checks, and real stdio MCP lifecycle tests.

## Current development priority

The MVP has enough capability to run real coding experiments. The priority is evidence and usability rather than feature count:

1. keep local-Agent installation and multi-project use reliable,
2. run paired baseline vs RepoScope tasks on real repositories,
3. measure verified success and context cost together,
4. improve localization/search only when benchmark evidence shows it is needed.
