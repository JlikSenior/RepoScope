# Cursor setup

RepoScope is designed to run as a local stdio MCP server. Cursor can start it directly through `npx`, so no machine-specific RepoScope checkout path is required.

## Project-scoped install (recommended during testing)

Run the installer from the project root:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-install
```

By default, `cursor-install` is **project-scoped**. It writes only inside the current project:

```text
<project>/
  .cursor/
    mcp.json
    rules/
      reposcope.mdc
    skills/
      reposcope/
        SKILL.md
      reposcope-benchmark/
        SKILL.md
```

The project MCP entry launches RepoScope through `npx`:

```json
{
  "mcpServers": {
    "reposcope": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "--prefer-online",
        "github:JlikSenior/RepoScope#main"
      ]
    }
  }
}
```

Existing project MCP servers in `.cursor/mcp.json` are preserved.

The installer also adds `.cursor/rules/reposcope.mdc` as an **Always Apply** project rule. Cursor includes Always Apply project rules in every Agent chat for the workspace, so the Agent is persistently instructed to use RepoScope for repository search/read/context instead of its built-in repository exploration tools.

This is behavioral guidance, not a security boundary: model instructions cannot physically disable Cursor's native tools. Benchmark runs should still be checked for direct-read/search fallback.

Cursor officially supports project MCP configuration at `.cursor/mcp.json`, project rules under `.cursor/rules/`, and project skills under `.cursor/skills/`, so RepoScope remains available only in that workspace. This is the recommended setup while RepoScope is being evaluated.

To install into a different project directory without changing the shell working directory:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-install --project /path/to/project
```

Because the GitHub repository is currently private, the local machine must already have GitHub Git access configured. No local RepoScope checkout path is required.

`--prefer-online` asks npm to check for a fresher package even when a cached copy exists, so the MCP config can follow the current `main` branch without being edited after RepoScope updates.

## Optional global install

Global installation is available, but it is **not the default**:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-install --global
```

This writes the MCP configuration to `~/.cursor/mcp.json` and the skills to `~/.agents/skills/`. It does not create the project-specific Always Apply rule.

During testing, prefer project scope so RepoScope can be enabled or removed independently for each repository.

## Multiple projects

With project-scoped installation, each workspace has its own Cursor MCP registration, project rule, and project skills.

RepoScope runtime state is independently isolated as well. Each target repository is canonicalized and assigned a path-derived project id. RepoScope-owned diagnostic/state files are kept outside the repository in a per-project state directory.

Task sessions are also bound to the repository they were created for. A `sessionId` from project A cannot be used to search/read/write project B.

Therefore these are separate concerns:

- `.cursor/` controls **where Cursor exposes and instructs use of RepoScope**.
- RepoScope's user state directory controls **where runtime state is stored and isolated**.

## Active session recovery

Active RepoScope task sessions are checkpointed into RepoScope's local user-state directory. If Cursor reloads MCPs or the stdio RepoScope process restarts, the next tool call using the existing `sessionId` can restore the active task instead of starting from an empty in-memory session.

The recoverable state includes the task budget, token usage, search/read event history, delivered-token accounting, read ranges, and guarded-write read authorization. RepoScope does **not** copy repository source contents into the checkpoint; source is still read from the repository when requested.

Full active snapshots remain project-isolated under the project's RepoScope state directory. A small state-root locator maps the opaque `sessionId` to its project id so `repo_session_status` and `repo_session_finish` can recover without adding a new `targetPath` argument.

Finished sessions are not recoverable as active work. `repo_session_finish` persists the existing final session report and removes the active recovery checkpoint. If a stale active checkpoint survives an interrupted finish but a final session report already exists, the final report wins and the session is not resurrected.

## Normal use

After installation, restart Cursor or reload MCPs. In the project, confirm that:

- MCPs includes `reposcope`.
- Rules includes the Always Apply RepoScope project rule.
- Skills includes `reposcope` and `reposcope-benchmark`.

The Always Apply rule is the persistent guardrail. For normal coding you can simply ask for the task. You can still invoke `/reposcope` explicitly when you want the detailed workflow instructions attached on demand.

Expected exploration sequence:

1. `repo_session_start`
2. `repo_search`
3. `repo_read` / `repo_context`
4. Agent reasoning and editing
5. repeat bounded RepoScope exploration only when necessary
6. verification when useful
7. `repo_session_finish`

If the Agent starts using Cursor's built-in codebase search/read for repository exploration, stop that run and point out the RepoScope project rule. For benchmark runs, treat such fallback as contamination.

## Benchmark mode

Use `/reposcope-benchmark` only for controlled A/B experiments. It disables model auto-invocation and requires RepoScope to be the only repository search/read/context channel for that experimental run.

A run is contaminated if the Agent falls back to Cursor's built-in repository search/read tools.

## Manual config only

If you do not want the installer to modify Cursor configuration, print the config snippet instead:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-config
```

## Future npm registry package

The GitHub package spec is the current zero-path installation method. Once RepoScope is published to the npm registry, the same `bin` entrypoint can be used with a normal registry package such as `npx -y reposcope@latest`; publishing is separate from the runtime/package work in this repository.
