# Range-level repository context

RepoScope can localize source at line-range granularity so a large matching file does not need to be delivered in full.

## Normal flow

```text
repo_search
  -> ranked file
  -> bounded match line hints
  -> repo_read.ranges
  -> expand only when needed
```

`repo_search` returns each result with:

- relative `path`
- search `score`
- `sizeBytes`
- fast `estimatedTokens`
- up to a bounded number of `{ line, term }` match hints

For large files, the Agent should start with a narrow `repo_read.ranges` window around a useful match, usually about 80-160 lines. One explicit range is capped at 400 lines.

Whole-file `repo_read.files` remains available for small files and compatibility.

## Range deduplication

Within a task session, RepoScope tracks delivered line coverage per file. If a later request overlaps an earlier range, only unseen lines are delivered and charged to the source-token budget.

A partial read also prevents `repo_context` from later redelivering the same file wholesale. If more of that file is needed, the Agent should request another explicit range.

Session metrics include `sourceLinesRead` in addition to source-token and file counts.

## Writes

Range reads do not weaken guarded writes. `repo_apply_patch` still requires existing files to have been completely read in the session before RepoScope itself will patch them.

This restriction applies to RepoScope's guarded patch utility; normal Agent/editor writes remain separate integration behavior.

## Why this exists

File-level localization can still waste context when a relevant file contains thousands of lines. Range-level delivery moves RepoScope's context boundary from:

```text
find fewer files
```

to:

```text
find fewer files
and deliver fewer irrelevant lines inside those files
```
