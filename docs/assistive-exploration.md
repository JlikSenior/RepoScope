# Assistive exploration experiment

RepoScope originally enforced an exclusive repository-context gateway: Agent guidance required repository search/read to go through RepoScope and prohibited native codebase exploration while RepoScope was available.

Real debugging feedback showed a failure mode that the original pilot did not represent well: RepoScope did not reduce provider-observed model tokens, while the fixed-string localization funnel could anchor the Agent on symptom-adjacent files and make distant root causes harder to discover.

This document defines the first causal correction experiment.

## Hypothesis

The primary hypothesis is:

> Root-cause regressions are caused mainly by making RepoScope localization an exclusive information boundary, rather than by RepoScope being present as an optional tool.

The assistive policy therefore changes only the Agent guidance layer first. Core search/read ranking, session source-budget behavior, and deduplication remain unchanged for this experiment so the gateway hypothesis can be tested without changing multiple mechanisms at once.

## Assistive policy

With the assistive policy:

- `repo_search` is a cheap fixed-string first pass, not an authority on relevance;
- missing or low-ranked files are not treated as irrelevant;
- native Agent codebase search, grep, semantic search, symbol/reference navigation, and direct reads remain allowed;
- debugging should broaden beyond RepoScope when the initial hypothesis is uncertain or symptom and cause may be distant;
- after one or two unproductive RepoScope localization steps, changing strategy is preferred over repeatedly refining the same keyword hypothesis;
- re-reading evidence through native tools is allowed when the working hypothesis changes;
- RepoScope `usedTokens` is explicitly described as RepoScope-delivered source, not total provider/model input tokens.

## Causal retest

Use a task that previously failed or became misdirected under the restrictive policy. Keep the following fixed:

- target repository and exact target commit;
- task prompt and acceptance criteria;
- Agent/model configuration and thinking level;
- verification command or other objective success criterion;
- machine/environment where practical.

Run at least these arms:

1. **Native baseline** — no RepoScope guidance controlling exploration.
2. **Restrictive RepoScope** — use a RepoScope revision before the assistive-policy change.
3. **Assistive RepoScope** — use the revision containing this policy change.

For each arm, record:

- objective task verification;
- whether the verified root cause was identified before editing;
- provider-observed model input tokens;
- provider-observed model output tokens;
- wall-clock duration;
- total tool calls when available;
- RepoScope MCP/source metrics for RepoScope arms.

Do not use whole-repository token estimates as the token-saving baseline. The relevant product comparison is provider-observed model usage for the same task.

## Interpretation

Evidence supporting the gateway hypothesis would look like:

```text
native verified success      = pass
restrictive RepoScope        = fail or wrong root cause
assistive RepoScope          = pass / root-cause behavior recovers
assistive provider tokens    ~= or < native provider tokens
```

If root-cause quality recovers but provider token usage is still not improved, the next experiment should isolate RepoScope overhead and task-level source-budget/dedup behavior.

If root-cause quality does not recover, the next investigation should focus on whether merely presenting fixed-string ranked results creates anchoring even when native exploration remains available.

## What this experiment does not claim

This policy change does not by itself prove that RepoScope saves tokens. It removes a known information-boundary risk so product value can be measured without intentionally disabling stronger Agent exploration mechanisms.
