# RepoScope Benchmark Pilot

This pilot replays five real problems from the original RepoScope prototype instead of inventing synthetic coding puzzles.

## Fixed starting revision

All five tasks start from:

```text
12ef553294645d6e96c09d5e77001c87f4054482
Initial RepoScope prototype
```

The task prompts are in `tasks.json`.

## What is being compared

For each task and trial, use the same local coding Agent/model twice.

### Baseline arm

The Agent works on the target worktree normally, using its normal repository search/read facilities.

Do not connect RepoScope to the Agent for this arm.

### RepoScope arm

Run the **current RepoScope main checkout** as the MCP server and point its tools at a separate target worktree checked out at the fixed starting revision.

For this arm:

- all repository **search/read/context exploration must go through RepoScope**;
- do not let the Agent use direct file-read/search tools as a fallback;
- normal editing facilities may still be used after the relevant code has been located;
- external verification is run by the benchmark operator, not by the Agent.

If the Agent bypasses RepoScope for repository exploration, mark the run invalid and rerun it. Do not include contaminated runs in A/B reduction calculations.

This isolates the product variable we actually care about: repository context delivery.

## Keep the verifier hidden from the Agent

The Agent receives only the task prompt from `tasks.json`.

Do **not** include `benchmarks/pilot/verify.mjs`, its source, or verifier implementation details in the task prompt/context. Run the verifier only after the Agent says it is done.

## Suggested worktree setup

From a normal up-to-date RepoScope checkout:

```bash
git worktree add ../reposcope-pilot-baseline 12ef553294645d6e96c09d5e77001c87f4054482
git worktree add ../reposcope-pilot-rs 12ef553294645d6e96c09d5e77001c87f4054482

(cd ../reposcope-pilot-baseline && npm install)
(cd ../reposcope-pilot-rs && npm install)
```

Reset or recreate the appropriate worktree before every new task/trial. Never reuse modifications from a previous run.

## Running a task

1. Choose one entry from `tasks.json`.
2. Start with a clean target worktree at the fixed commit.
3. Give the Agent only the task `prompt`.
4. Run either the baseline or RepoScope arm according to the rules above.
5. Stop timing when the Agent declares the task complete/failed/abandoned.
6. Run the external verifier from the **current harness checkout**:

```bash
node benchmarks/pilot/verify.mjs <taskId> ../reposcope-pilot-baseline
```

or:

```bash
node benchmarks/pilot/verify.mjs <taskId> ../reposcope-pilot-rs
```

A zero exit code means objective verification passed.

## Metrics to record

Create one JSONL benchmark record per arm using the schema in `docs/benchmark.md`.

At minimum record:

- `runId`
- `taskId`
- `mode`
- `agent`
- `repository`
- exact `commit`
- `trial`
- Agent-reported `outcome`
- external `verification`
- any metrics that can actually be observed

Prefer provider-observed `modelInputTokens` when your Agent exposes it. Never invent baseline source-token counts if the Agent does not provide enough telemetry.

For RepoScope runs, copy source/MCP metrics from `repo_session_finish` / `repo_session_status` when applicable.

## Pilot tasks

The first five tasks cover different failure classes:

| taskId | Class | What it probes |
| --- | --- | --- |
| `session-start-scaling` | performance | localization of an expensive whole-repo operation |
| `context-read-dedup` | correctness | cross-tool session state and duplicate context delivery |
| `bounded-search-results` | context efficiency | controlling path-list/tool overhead |
| `mcp-typecheck-coverage` | build correctness | locating a configuration gap outside ordinary `.ts` code |
| `search-ai-readable-boundary` | correctness | keeping search consistent with repository read boundaries |

## Initial pilot size

Start small:

```text
5 tasks × 1 trial × 2 arms = 10 runs
```

Do not optimize RepoScope based on one task. First collect the complete 10-run pilot and inspect:

- verified success parity;
- model/context reduction where observable;
- files read / exploration calls;
- tasks where RepoScope fails but baseline passes;
- tasks where RepoScope needs unexpectedly many search/read iterations.

Only then decide what to change in Core.
