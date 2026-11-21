# Repository Agent Rules

## Plugin format

- The only supported plugin package format is the official Claude Code Plugin directory format.
- Import plugins using the Claude Code conventions: `.claude-plugin/plugin.json` when a manifest is supplied, and standard component directories such as `skills/`, `commands/`, and `agents/`. Follow the Claude Code specification for optional manifest fields and directory layout.
- Do not create, retain, or restore an application-specific plugin manifest format such as `manifest.json`.
- Do not add backward-compatibility adapters, migration paths, fallback parsers, or tests for the retired application-specific plugin format. Breaking compatibility with that format is intentional.
- Keep the importer, runtime metadata, examples, tests, settings UI, and documentation aligned with the Claude Code Plugin format only.
- Treat imported plugin content as untrusted. Do not execute plugin JavaScript, hooks, scripts, or start external services unless an explicit, separately reviewed runtime feature is implemented.
