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

## Search quality vs localization quality

RepoScope keeps two related metrics separate so the historical `repo_search` measurement does not silently change meaning.

`searchQuality` is the original metric. It measures only explicit `repo_search` calls and remains useful for answering questions such as:

- how many explicit search results were eventually read,
- whether files that were read had appeared in explicit search before their first read,
- the best explicit-search rank of files that were later read,
- whether the Agent repeated effectively identical explicit searches.

`localizationQuality` is the preferred broader metric for new sessions. It measures repository localization performed by both:

- explicit `repo_search`, and
- internal search performed by `repo_context` when search terms, rather than explicit file hints, determine candidate files.

Explicit `fileHints` do not count as search localization because the file was already supplied directly.

A file receives localization credit only if it appeared in a localization result before the file's first read. Later searches cannot retroactively claim credit.

`localizationQuality` also reports separate `repoSearchCount` and `repoContextCount`, plus combined conversion, coverage, best-rank, Top-1/3/5 hit rates, and repeated-localization rate. Repeated localization normalizes term case, order, whitespace, and duplicates across both tool sources, so a `repo_search` followed by a `repo_context` that re-runs the same effective query is observable rather than hidden.

Older persisted sessions do not contain localization events. They remain readable, but are excluded from localization-quality averages instead of being treated as zero-quality samples. Their existing `searchQuality` metrics remain unchanged.

## Tool latency

RepoScope records end-to-end latency for `repo_session_start`, `repo_search`, `repo_read`, and `repo_context`.

The reported tool duration is intended to approximate the time the Agent waits for the RepoScope MCP handler. It includes:

- active-session recovery when a previous MCP process must be restored,
- repository scanning and ripgrep work performed by the tool,
- source reading and token accounting,
- response construction and tracked response-token accounting,
- active-session checkpoint persistence performed before the tool call returns.

Scanner and ripgrep timings remain available as component attribution inside the latency report. The difference between total tool latency and those measured components includes other RepoScope processing such as file reads, tokenization, response construction, recovery, and checkpoint persistence.

Latency does not include model inference time, Agent reasoning time, MCP transport time after the handler returns, or unrelated Cursor/provider work.

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
