---
name: reposcope
description: Use RepoScope as an assistive repository exploration and observability layer for local coding tasks. Apply when exploring, debugging, refactoring, or changing a codebase with RepoScope MCP tools available.
---

# RepoScope

Use RepoScope to reduce unnecessary repository context when it helps, but do not treat RepoScope results as a complete or authoritative view of the codebase.

RepoScope is an assistive exploration layer, not a mandatory repository-access gateway. Native Agent search, semantic search, grep, symbol/reference navigation, and direct source reads remain allowed at any time.

## Workflow

1. When using RepoScope, start one task session with `repo_session_start` for the current repository root and user task so RepoScope-side exploration can be measured.
2. Keep the returned `sessionId` for RepoScope calls during the task.
3. Use `repo_search` as a cheap first-pass localization tool when task-derived fixed-string terms are likely to be useful.
4. Treat ranked RepoScope results as hints, not proof that higher-ranked files are more causally important or that omitted files are irrelevant.
5. Use `repo_read.ranges` when a narrow source window is sufficient. Whole-file reads are fine when structure, lifecycle, control flow, or distant definitions matter.
6. Use native Agent repository tools whenever they provide a better investigation path. In particular, broaden beyond RepoScope when the initial hypothesis is uncertain, the symptom is likely distant from the cause, semantic/reference navigation is needed, or RepoScope results do not explain the observed behavior.
7. Re-read source when a changed hypothesis makes earlier evidence important again. Do not avoid a useful re-read merely because RepoScope has already delivered that range.
8. Use normal Agent editing facilities after enough evidence has been gathered. RepoScope guarded patching remains optional and has its own full-read safety requirement.
9. If the repository exposes approved verification commands, use `repo_commands` and `repo_run` when useful; native verification facilities remain allowed too.
10. Finish the RepoScope session with `repo_session_finish` if one was started.

## Investigation protocol

For debugging, correctness review, or "is this implementation wrong?" tasks:

1. Start from the observed symptom and keep more than one plausible hypothesis alive when evidence is weak.
2. Trace concrete evidence chains such as producer -> transformation -> consumer, but do not assume the shortest textual path is the causal path.
3. Prefer current implementation, tests, concrete inputs, logs, references/callers, configuration, and reproducible examples as evidence.
4. Keep conclusions separated as **confirmed**, **suspected**, or **unknown**. Do not promote a suspicion to a root cause without direct evidence.
5. When practical, look for a counterexample or reproducer that distinguishes the leading hypothesis from plausible alternatives.
6. If one or two RepoScope localization steps fail to produce direct evidence, broaden the investigation instead of repeatedly refining the same keyword hypothesis.
7. Use conversation history, Git history, or broad metadata when they answer a concrete unresolved question.
8. Stop exploring once the evidence is sufficient for the user's requested confidence level.

## Loop guard

- Do not repeat the same failed tool call with materially identical inputs.
- After a repeated identical failure with no new evidence, change strategy or report the limitation instead of retrying indefinitely.
- A retry should be justified by a concrete change in inputs, context, or expected outcome.
- Switching from RepoScope to native Agent exploration is a valid strategy change, not a failure of the task.

## Context rules

- Do not read or scan the whole repository by default, regardless of which exploration tool is used.
- Do not infer that files absent from `repo_search` are irrelevant.
- Do not infer that the top-ranked RepoScope result is the root cause.
- Native repository search/read/navigation is explicitly allowed while this skill is active.
- RepoScope source budgets and `usedTokens` measure RepoScope-delivered source, not total provider/model input tokens. Use provider-observed model tokens for product-level token comparisons when available.
- RepoScope deduplication is an accounting/optimization signal, not a rule that the Agent must never inspect the same evidence again through native tools.
- Keep source acquisition separate from reasoning: RepoScope supplies evidence; the Agent remains responsible for deciding when to broaden or change the investigation method.
