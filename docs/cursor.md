# Cursor setup

RepoScope is designed to run as a local stdio MCP server. Cursor can start it directly through `npx`, so no machine-specific RepoScope checkout path is required.

## One-time install

Run:

```bash
npx -y --prefer-online github:JlikSenior/RepoScope#main cursor-install
```

The installer preserves existing Cursor MCP servers and adds:

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

It also installs these global Agent Skills under `~/.agents/skills/`:

- `reposcope` — normal local coding workflow.
- `reposcope-benchmark` — strict benchmark mode; explicit invocation only.

Cursor discovers `~/.agents/skills/` automatically.

Because the GitHub repository is currently private, the local machine must already have GitHub Git access configured. No local RepoScope project path is required.

`--prefer-online` asks npm to check for a fresher package even when a cached copy exists, so the MCP config can follow the current `main` branch without being edited after RepoScope updates.

## Normal use

After installation, restart Cursor or reload MCPs. In Cursor's Customize view, confirm that:

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
