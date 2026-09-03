# RepoScope observability

RepoScope keeps repository-context metrics separate from provider billing metrics.

## Finished session history

Each successful `repo_session_finish` response is also persisted outside the target repository under the project's RepoScope state directory:

```text
<state-root>/projects/<project-id>/sessions/<session-id>.json
```

Persistence is best-effort. A state-directory write failure is logged by the MCP server but does not make an otherwise completed coding task fail.

From the target project root, summarize accumulated finished sessions with:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main project-report
```

The report includes:

- outcome and verification counts,
- average source and MCP delivery tokens,
- average files/searches/reads,
- average source/net reduction,
- recent session summaries.

This is intended for continuous real-world observation when exact paired baseline tasks are not available. Different tasks have different complexity, so trends should not be treated as controlled A/B evidence.

## Repository baseline audit

`wholeRepoTokens` is a fast estimate, not an exact tokenizer result and not a provider billing number. It is computed as:

```text
sum(ceil(AI-readable file bytes / 4))
```

To explain that estimate for the current repository, run:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main repo-stats
```

The command uses the same scanner boundary and estimation formula as session startup. It reports:

- number of AI-readable files,
- total AI-readable bytes,
- `estimatedWholeRepoTokens`,
- directories contributing the most estimated tokens,
- largest included text files.

Use this when a whole-repository estimate looks unexpectedly large. Large generated text, fixtures, JSON, or other scanner-accepted files can legitimately dominate the estimate even though RepoScope may never deliver them during a task.

## Interpreting the numbers

The important distinctions are:

- `estimatedWholeRepoTokens` / `wholeRepoTokens`: repository-size baseline only.
- `usedTokens`: unique source tokens actually delivered and charged against the RepoScope task budget.
- `deliveredTokens`: tracked MCP response payload tokens, including RepoScope protocol/tool overhead.
- provider/model tokens: only authoritative when reported by the provider or Agent itself.

A high source-reduction percentage means RepoScope exposed much less repository context than the whole-repository baseline. It does **not** mean the provider bill decreased by the same percentage.
