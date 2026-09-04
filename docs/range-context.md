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

## Range-aware `repo_context`

`repo_context` also uses line-range delivery for the normal search-selected path.

- Files up to 200 lines remain whole-file context.
- Larger files are represented by match-centered windows with a default radius of 40 lines, normally about 81 lines per isolated match.
- Nearby or overlapping match windows are merged before delivery.
- The packet labels each fragment with its source range, for example `L260-340 of 500`.
- Explicit `fileHints` remain backward-compatible: a large explicitly hinted file with no usable search match can still be delivered whole when the budget allows it.

This makes `repo_context` suitable for bounded task packets without turning a single hit in a large file into an automatic whole-file delivery.

## Range deduplication

Within a task session, RepoScope tracks delivered line coverage per file. If a later request overlaps an earlier range, only unseen lines are delivered and charged to the source-token budget.

Deduplication is cross-tool. A partial `repo_read` no longer causes `repo_context` to treat the entire file as exhausted: if a later search points to a distant unread region in the same file, `repo_context` can deliver that new range while still suppressing genuinely overlapping lines.

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
