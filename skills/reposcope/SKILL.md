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
4. Use `repo_read` for only the most relevant files. Use `repo_context` only when a compact multi-file packet is more useful than explicit reads.
5. Reason from the delivered code. Search/read again only when there is a concrete information gap.
6. After relevant source has been obtained through RepoScope, use normal Agent editing tools or RepoScope guarded write utilities as appropriate.
7. If the repository exposes approved verification commands, use `repo_commands` and `repo_run` when verification is useful.
8. Inspect `repo_diff` / `repo_status` when RepoScope write utilities were used.
9. Finish with `repo_session_finish`, using an outcome that reflects the actual result.

## Context rules

- Do not scan or read the whole repository by default.
- While this skill is active, use RepoScope for repository search, codebase exploration, and source reads instead of built-in codebase search/grep/read tools.
- Do not silently fall back to direct repository reads if RepoScope cannot provide required context. Explain the limitation first.
- Do not request a source-token budget close to the whole-repository estimate. Start bounded and keep exploration incremental.
- Avoid repeated reads. RepoScope session deduplication should remain the source of truth for what has already been delivered.
- Keep source acquisition separate from editing: RepoScope is the context gateway, not the reasoning model.
