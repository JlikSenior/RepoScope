---
name: reposcope
description: Use RepoScope as the repository context gateway for local coding tasks. Apply when exploring, debugging, refactoring, or changing a codebase with RepoScope MCP tools available.
---

# RepoScope

Use RepoScope to control repository context. The goal is to solve the task while reading only the source that is actually needed.

## Workflow

1. Start one task session with `repo_session_start` for the current repository root and user task.
2. Keep the returned `sessionId` for the whole task.
3. Use `repo_search` to localize likely files. Use a small set of task-derived search terms and bounded result counts.
4. Inspect each search result's match line numbers and estimated file size. Prefer `repo_read.ranges` around relevant matches instead of whole-file reads.
5. Start with a narrow local window, usually about 80-160 lines around a match. Expand or request another range only when there is a concrete information gap. A single explicit range is capped by RepoScope.
6. Use whole-file `repo_read.files` only when the file is clearly small or the full file is genuinely needed. Avoid `repo_context` for large-file exploration because it may deliver complete files; prefer search plus ranged reads.
7. Reason from the delivered code. Search/read again only when there is a concrete information gap.
8. After relevant source has been obtained through RepoScope, use normal Agent editing tools or RepoScope guarded write utilities as appropriate. RepoScope guarded patching requires a complete read of existing files; native editor writes do not change that repository-context rule.
9. If the repository exposes approved verification commands, use `repo_commands` and `repo_run` when verification is useful.
10. Finish with `repo_session_finish`, using an outcome that reflects the actual result.

## Investigation protocol

For debugging, correctness review, or "is this implementation wrong?" tasks:

1. State the exact question or hypothesis before broadening exploration.
2. Trace the shortest direct evidence chain: producer -> transformation -> consumer.
3. Prefer current implementation, tests, concrete inputs, logs, or reproducible examples as evidence.
4. Keep conclusions labeled mentally as **confirmed**, **suspected**, or **unknown**. Do not promote a suspicion to a root cause without direct evidence.
5. When practical, look for a counterexample or reproducer that distinguishes the leading hypothesis from plausible alternatives.
6. Use conversation history, Git history, or broad metadata only when the current-code evidence chain has a specific unresolved gap that those sources can answer.
7. Stop exploring once the evidence is sufficient for the user's requested confidence level.

## Loop guard

- Do not repeat the same failed tool call with materially identical inputs.
- After a repeated identical failure with no new evidence, change strategy or report the limitation instead of retrying indefinitely.
- A retry should be justified by a concrete change in inputs, context, or expected outcome.

## Context rules

- Do not scan or read the whole repository by default.
- Do not read an entire large source file merely because search found one matching line.
- While this skill is active, use RepoScope for repository search, codebase exploration, and source reads instead of built-in codebase search/grep/read tools.
- Do not silently fall back to direct repository reads if RepoScope cannot provide required context. Explain the limitation first.
- Do not request a source-token budget close to the whole-repository estimate. Start bounded and keep exploration incremental.
- Avoid repeated or overlapping reads. RepoScope range deduplication should remain the source of truth for what has already been delivered.
- Keep source acquisition separate from editing: RepoScope is the context gateway, not the reasoning model.
