# Plugin Architecture

**Status:** Proposed  
**Scope:** Local, single-user desktop application; architecture only

## 1. Goal

Support different team and individual workflows without creating separate application builds or adding team-specific branches to the core application.

Keep the design deliberately small:

- The **Host** owns Electron lifecycle, trusted IPC, storage, layout and execution boundaries.
- A **Plugin** is an installable bundle of declarative capabilities and configuration.
- A **Profile** selects plugins and supplies team defaults.
- The existing host services execute operations and enforce permissions.

This is a local extension mechanism, not a general-purpose plugin platform or marketplace.

## 2. What is a plugin?

For the first version, a plugin is a directory or archive containing a manifest and optional resource files. It may contribute only these four things:

| Contribution | Meaning | Example |
|---|---|---|
| Skill | Instructions, domain knowledge and working conventions | Research memo standards |
| Tool reference | An identifier for a tool already implemented by the host | Search local documents |
| Workflow | A reusable task template or sequence | Prepare a research brief |
| View declaration | A request to show a host-provided panel or view | Source comparison panel |

An Agent is composed by the host from its instructions, selected skills and available tools; it is not a separate plugin runtime. Context belongs in skills or referenced resources. Provider/model configuration remains an application or user setting. Integrations are configured through supported host tools.

A plugin may contain any combination of the four contributions. It does not ship arbitrary executable JavaScript in the first version.

## 3. Package and manifest

Use a versioned directory or ZIP. No marketplace, remote catalog, dependency solver or package manager is needed initially.

Example:

```json
{
  "manifestVersion": 1,
  "id": "team.research",
  "name": "Research Workspace",
  "version": "1.0.0",
  "skills": ["skills/research.md"],
  "tools": ["document.search", "document.read"],
  "workflows": ["workflows/research-brief.md"],
  "views": ["views/source-comparison.json"]
}
```

The host validates the manifest, paths and supported contribution types on import. Tool references must resolve to tools known by the application; a plugin cannot introduce an arbitrary executable handler or grant itself access to host APIs.

Keep the manifest small. Add fields only when a real use case requires them. Do not add dependency graphs, activation-event systems, per-field merge policies or a generic extension SDK in advance.

## 4. Host responsibilities

The host provides one small Plugin Registry that records installed packages, validates manifests and exposes their declared contributions to the active profile.

The basic lifecycle is:

1. Import package.
2. Validate and register its manifest.
3. Enable or disable it.
4. Remove it.

Activation is driven by the active profile. There is no separate plugin event bus or multi-stage runtime lifecycle in the first version.

Tools continue to execute through the application's existing host-controlled tool path. That path validates inputs and applies the relevant permission/confirmation checks before execution. The plugin registry is for discovery and composition; it is not a second tool runtime or a second authorization system.

Plugin files are data, not trusted code. The host must prevent path traversal on import, validate referenced files, and keep remote browser content outside the plugin trust boundary. Any future support for executable third-party extensions requires a separate design and explicit isolation model.

## 5. Profiles and workspace

A profile selects installed plugins, provides non-secret plugin configuration and optionally selects a saved layout.

The initial model is intentionally limited:

- One built-in default profile.
- Import/export of Team Profiles as JSON.
- Local user overrides for personal preferences and layout.
- Temporary session changes are not written back automatically.

Do not implement organization baselines, profile inheritance chains, remote synchronization or a generic configuration-composition engine until real usage demonstrates the need. Security permissions and secret values are never profile data.

See [Profile Composition](./PROFILE-COMPOSITION.md).

## 6. UI and Layout Engine

A plugin may declare a view that the host already knows how to render. The host decides whether it is available and where it appears.

The existing Layout Engine remains the single owner of workspace geometry, docking, split ratios, tab groups, floating Agent window state and layout persistence. Plugin declarations do not get direct access to Electron `WebContentsView`, bounds or arbitrary renderer state.

Do not create a second plugin-specific layout system. Do not make every existing application feature a plugin; migrate a feature only when it provides a concrete reuse or configuration benefit.

## 7. Security and diagnostics

- A plugin cannot execute arbitrary code or access Node.js/Electron APIs.
- A plugin's tool references do not grant permissions.
- Every tool invocation remains subject to the host's existing validation and authorization path.
- Import validates archive paths and rejects unsupported or malformed content.
- Diagnostics should report import/validation errors and tool failures with plugin attribution. Do not build a separate telemetry pipeline.

## 8. Incremental delivery

1. **Package format:** manifest validation and local import/export.
2. **Profile:** select installed plugins and apply team defaults.
3. **Host integration:** expose selected skills, tool references, workflows and supported views to the existing Agent/workspace.
4. **Adoption:** convert existing features only where it reduces team-specific code or improves reuse.

Do not implement arbitrary executable plugins, marketplace distribution, dependency resolution, event hooks or remote administration as part of this work.

## 9. Acceptance criteria

- A user can import, enable, disable and remove a valid plugin package.
- A Team Profile can select installed plugins and be shared without secrets or machine-local state.
- Missing or invalid plugin contributions are reported without preventing unrelated features from working.
- Tool execution still goes through the host's existing validation and permission checks.
- Plugin content cannot directly access Electron APIs or native view bounds.
- Existing browser, Agent and Layout Engine behavior remains unchanged unless a feature is deliberately migrated.
