# Cursor setup

RepoScope is designed to run as a local stdio MCP server. Cursor is one first-class RepoScope Agent adapter alongside Codex and future MCP-capable coding Agents.

## Project-scoped install

Run the generic Agent installer from the project root:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main install cursor
```

The first project install on a machine ensures one fixed local RepoScope runtime exists. Later project installs reuse that runtime instead of creating a per-project runtime copy.

The older `cursor-install` command remains available as a compatibility alias. New project setup should prefer `install cursor`.

The Cursor adapter writes only inside the current project:

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

The project MCP entry launches the fixed local RepoScope runtime directly and hard-binds that MCP process to the canonical project root:

```json
{
  "mcpServers": {
    "reposcope": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/reposcope/runtime/current/node_modules/reposcope/dist/bin.mjs",
        "mcp",
        "--project",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

The Runtime entry is shared across projects. The absolute project argument is intentionally project-specific. Two workspaces with the same directory/repository name still receive different MCP startup identities because their canonical roots differ. RepoScope also enforces that bound root internally: a project-bound MCP process rejects repository scan/search/session-start requests aimed at another project.

Normal Cursor MCP startup no longer runs `npx`, fetches the GitHub package, or rebuilds RepoScope. The initial `npx ... install cursor` command is only the bootstrap path used to ensure the local Runtime exists and write the Adapter configuration.

Existing project MCP servers in `.cursor/mcp.json` are preserved.

The adapter also adds `.cursor/rules/reposcope.mdc` as an **Always Apply** project rule and installs the packaged RepoScope Skills under `.cursor/skills/`.

This is behavioral guidance, not a security boundary: model instructions cannot physically disable Cursor's native tools. Benchmark runs should still be checked for direct-read/search fallback.

To install into a different project directory without changing the shell working directory:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main install cursor --project /path/to/project
```

Because the GitHub repository is currently private, the initial bootstrap machine must already have GitHub Git access configured. No local RepoScope checkout path is required.

## Optional legacy global install

Global Cursor installation remains available only through the compatibility command:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-install --global
```

This writes the MCP configuration to `~/.cursor/mcp.json` and the skills to `~/.agents/skills/`. It remains an unbound legacy path because one global registration may be used by multiple repositories. Project-scoped installation is the recommended product path.

## Multiple projects

With project-scoped installation, each workspace has its own Cursor MCP registration, project rule, project skills, and canonical `--project` startup argument, while all projects can reuse the same installed Runtime entry.

RepoScope runtime state is independently isolated as well. Each target repository is canonicalized and assigned a path-derived project id. RepoScope-owned diagnostic/state files are kept outside the repository in a per-project state directory.

Project-scoped MCP processes do not need the state-root-wide active-session locator index. Active checkpoints live only under the matching path-derived project directory, and bound recovery reads that directory directly. The legacy global locator remains available only for unbound/global compatibility.

Task sessions are also bound to the repository they were created for. A `sessionId` from project A cannot be recovered or used by a project-bound MCP process for project B.

Therefore these are separate concerns:

- the fixed local Runtime controls **which RepoScope code is executed** and is intentionally shared,
- `.cursor/` controls **where Cursor exposes and instructs use of RepoScope** and gives each project a distinct `--project` identity,
- RepoScope's user state directory controls **where runtime state is stored**; project-bound active state stays within one path-derived project directory.

## Runtime lifecycle

Inspect or refresh the fixed local Runtime with:

```bash
reposcope runtime status
reposcope runtime install
```

Runtime replacement is staged and validated before the stable `current` directory is switched. Normal Cursor starts keep pointing at the same stable path.

See [`runtime.md`](runtime.md) for Runtime locations, update behavior, and npm-cache handling.

## Active session recovery and cleanup

Active RepoScope task sessions are checkpointed into RepoScope's local user-state directory. If Cursor reloads MCPs or the stdio RepoScope process restarts, the next tool call using the existing `sessionId` can restore the active task instead of starting from an empty in-memory session.

The recoverable state includes the task budget, token usage, search/read event history, delivered-token accounting, read ranges, and guarded-write read authorization. RepoScope does **not** copy repository source contents into the checkpoint; source is still read from the repository when requested.

For project-bound MCP processes, full active snapshots remain under that project's RepoScope state directory and no new shared active locator is created. On startup, RepoScope also removes stale atomic temporary files older than one hour and abandoned active checkpoints older than seven days from that project only. When a stale old-format active checkpoint is removed, the matching legacy locator is removed as well.

Finished session reports are not treated as temporary garbage because they feed observability and `project-report`; their retention/compaction policy is separate from active-state cleanup.

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

If you do not want the installer to modify Cursor configuration, print the generic legacy unbound npx config snippet instead:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-config
```

For normal project use, prefer `install cursor` because it ensures the fixed local Runtime and writes the project-bound `--project` argument automatically.
