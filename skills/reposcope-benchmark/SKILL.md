---
name: reposcope-benchmark
description: Run the RepoScope arm of a controlled A/B coding benchmark. Use only when explicitly evaluating RepoScope against a baseline on a fixed task and repository revision.
disable-model-invocation: true
---

# RepoScope Benchmark Mode

This skill is for controlled experiments, not normal coding.

## Experimental rule

RepoScope must be the only repository search/read/context channel for the run. Do not use built-in codebase search, grep, semantic search, file browsing, or direct source-reading tools to discover or inspect repository code.

If direct repository search/read is used accidentally, treat the run as contaminated and report it instead of continuing as a valid benchmark sample.

## Workflow

1. Confirm the target repository is at the benchmark's fixed revision and the worktree is clean.
2. Start exactly one `repo_session_start` using the benchmark task text.
3. Use `repo_search` to localize source and use returned match lines to drive ranged `repo_read` requests. Prefer narrow ranges and expand only when necessary; avoid whole large-file reads.
4. Use `repo_context` only when the benchmark task genuinely benefits from a compact packet and it will not unnecessarily broaden source delivery.
5. Keep one `sessionId` throughout the run.
6. Use normal editing tools after relevant source has been delivered through RepoScope. Editing itself is not the experimental variable.
7. Run only the benchmark-approved verification path. Do not inspect hidden verifier implementation unless the benchmark protocol explicitly permits it.
8. Finish with `repo_session_finish` and preserve its metrics for the benchmark record.
9. Record provider-observed token metrics only when actually available; never estimate missing provider billing/context numbers.

## Integrity

- Do not broaden the source budget simply to make the task easier unless the benchmark protocol allows it.
- Do not inspect the baseline solution or another trial's changes.
- Do not use hidden verifier source as implementation guidance.
- Separate Agent-reported outcome from objective verification.
