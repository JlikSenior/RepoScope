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

Cursor officially supports project MCP configuration at `.cursor/mcp.json` and project skills under `.cursor/skills/`, so RepoScope remains available only in that workspace. This is the recommended setup while RepoScope is being evaluated.

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

This writes the MCP configuration to `~/.cursor/mcp.json` and the skills to `~/.agents/skills/`.

During testing, prefer project scope so RepoScope can be enabled or removed independently for each repository.

## Multiple projects

With project-scoped installation, each workspace has its own Cursor MCP registration and project skills.

RepoScope runtime state is independently isolated as well. Each target repository is canonicalized and assigned a path-derived project id. RepoScope-owned diagnostic/state files are kept outside the repository in a per-project state directory.

Task sessions are also bound to the repository they were created for. A `sessionId` from project A cannot be used to search/read/write project B.

Therefore these are separate concerns:

- `.cursor/` controls **where Cursor exposes RepoScope**.
- RepoScope's user state directory controls **where runtime state is stored and isolated**.

## Normal use

After installation, restart Cursor or reload MCPs. In the project, confirm that:

- MCPs includes `reposcope`.
- Skills includes `reposcope` and `reposcope-benchmark`.

For normal coding, the `reposcope` skill can be selected explicitly with `/reposcope` or applied automatically when Cursor considers it relevant.

The skill tells the Agent to:

1. start one RepoScope session for the task,
2. use RepoScope for repository search/read/context,
3. keep one `sessionId`,
4. acquire source incrementally instead of reading the whole repository,
5. keep normal editing ergonomics,
6. finish the RepoScope session at the end.

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
