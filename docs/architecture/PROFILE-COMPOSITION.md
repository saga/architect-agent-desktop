# Workspace Profile Composition

**Status:** Proposed  
**Scope:** Design only  
**Related:** [Plugin Architecture](./PLUGIN-ARCHITECTURE.md)

## 1. Purpose

A plugin system makes capabilities reusable. Profiles make those capabilities useful to different teams and people.

A Team Profile should describe a working environment—not a separate application build. It selects plugins, configures their contributions, defines the workspace layout and sets role-oriented defaults. A user can then make permitted personal adjustments without changing the shared team definition.

Examples:

- **Research Team:** source discovery, document reading, research workflow, citations and a research-oriented panel layout.
- **Engineering Team:** repository tools, issue context, code review workflow and terminal/document panels.
- **Operations Team:** operational runbooks, status tools, controlled workflows and monitoring panels.
- **Individual User:** preferred model/provider settings, personal shortcuts, panel arrangement and optional personal plugins.

These are illustrative profiles, not built-in product commitments.

## 2. Profile model

A profile is a versioned, portable configuration document containing:

- Identity and metadata.
- Parent profile reference, if inheritance is used.
- Selected plugin IDs and compatible version constraints.
- Plugin contribution enablement.
- Plugin configuration values.
- Workspace layout reference or embedded layout definition.
- Optional task presets and command visibility.
- Compatibility requirements.

A profile does not contain plugin executable code, credentials, secret values or host security policy.

Illustrative profile:

```json
{
  "schemaVersion": "1",
  "id": "team.research",
  "name": "Research Team",
  "description": "Research-oriented workspace",
  "plugins": {
    "com.example.research-tools": {
      "enabled": true,
      "version": "^1.2.0",
      "configuration": {
        "defaultOutput": "research-brief"
      },
      "contributions": {
        "tools": ["source.search", "document.read"],
        "views": ["research.sources", "research.notes"]
      }
    }
  },
  "workspace": {
    "layoutId": "research.default"
  },
  "taskPresets": []
}
```

The example is illustrative; the exact schema and identifiers are to be finalized before implementation.

## 3. Layering and precedence

The target model is:

```text
Built-in Defaults
  -> Organization / Shared Baseline (optional)
    -> Team Profile
      -> User Overrides
        -> Session Overrides
```

### Built-in Defaults

Provide a usable workspace when no imported profile exists. This layer is shipped and versioned with the application.

### Organization / Shared Baseline

An optional future layer for centrally distributed defaults or restrictions. It is not required for the local-first product and must not be introduced as a prerequisite.

### Team Profile

The reusable definition of how a team works. It is imported/exported as a file or package and can be version-controlled outside the application.

### User Overrides

Personal settings layered on top of the Team Profile, such as preferred panel arrangement, optional enabled plugins, display preferences and personal task presets—subject to policy.

### Session Overrides

Temporary changes for the current workspace session. These should be easy to clear and must not silently alter saved profiles or user preferences.

## 4. Deterministic merge rules

The effective profile must be deterministic and inspectable.

1. Resolve the profile chain and validate every schema version.
2. Resolve plugin dependencies and version constraints.
3. Merge ordinary configuration values according to each plugin's declared schema.
4. Apply contribution enablement only when the plugin is installed and allowed.
5. Resolve layout references and migrate compatible snapshots.
6. Apply host policy after configuration composition.
7. Produce an effective-profile view that identifies the source layer of each resolved value.

Do not use a generic deep-merge algorithm as the entire policy. Plugin schemas must define merge behavior for fields where arrays, maps or structured objects have meaningful semantics.

Suggested field merge strategies:

| Field shape | Default merge behavior |
|---|---|
| Scalar | Higher layer replaces lower layer |
| Object | Recursive merge only where schema permits |
| Array of stable IDs | Replace by default; explicit set semantics where required |
| Secret reference | Reference may be overridden; secret value is never exported |
| Permission / policy | Not profile-overridable |
| Layout | Higher layer selects a complete named layout or an explicit patch format |

Conflicts must be visible. Silent fallback to a different plugin or capability can change a workflow in ways users do not expect.

## 5. Configuration scopes

Every configuration value should have a declared scope:

- **Application:** applies across profiles, such as theme or startup behavior.
- **Profile:** shared configuration belonging to a profile.
- **User:** private preference for the current user.
- **Session:** temporary value for the active session.
- **Secret:** credential or sensitive value held outside exported profile data.

A plugin configuration schema should declare which fields can be set at which scope. A profile must not smuggle user secrets into a shared definition.

## 6. Profile portability

A Team Profile should be portable between installations without requiring the sender's local machine state.

Export should include:
- Profile metadata and schema version.
- Plugin IDs and version constraints.
- Non-secret plugin configuration.
- Layout definition or stable layout reference.
- Optional task presets.

Export must exclude:
- Credentials, access tokens and private keys.
- Local absolute paths unless explicitly represented as unresolved placeholders.
- Runtime session state.
- User-specific private overrides.
- Permission grants and prior approval decisions.

Import should:
1. Parse and validate the profile.
2. Show required, optional and missing plugins.
3. Check version compatibility.
4. Display configuration changes and unsupported fields.
5. Apply host policy and permission checks independently.
6. Allow the user to choose whether to activate the imported profile.

Importing a profile must never automatically install arbitrary executable code or grant permissions.

## 7. Plugin availability and compatibility

A profile may reference a plugin that is missing, disabled, incompatible or blocked by policy. These are distinct states and should be surfaced separately.

Recommended behavior:

- Missing optional plugin: load the rest of the profile and show a clear warning.
- Missing required plugin: mark the profile incomplete and explain what is unavailable.
- Incompatible plugin version: do not activate it; show the required range and installed version.
- Policy-blocked plugin: do not activate it, even if the profile requests it.
- Plugin activation failure: retain the profile, isolate the failure and offer diagnostics.

The system must not silently substitute a similarly named plugin.

## 8. Layout association

Profiles may refer to a named layout. The layout is a declarative snapshot managed by the host Layout Engine.

A layout definition should identify:
- Layout schema version.
- View contribution IDs.
- Dock/split relationships.
- Relative sizing and minimum constraints.
- Active view and tab group.
- Optional per-view presentation state.

A layout must not contain executable code, Electron object references or raw window bounds. The Layout Engine resolves view IDs against currently available UI contributions and applies safe fallback behavior when a view is absent.

User layout overrides should be stored separately from the Team Profile unless the user explicitly chooses to publish an updated team layout.

## 9. Profile UX

The profile experience should answer three questions without exposing implementation complexity:

1. **What workspace am I using?** Show active profile name and source.
2. **What does it enable?** Show included plugins and their contribution summaries.
3. **What can I personalize?** Expose permitted user-level preferences without allowing policy changes.

Recommended user actions:
- Switch active profile.
- Import/export a Team Profile.
- View missing or incompatible plugins.
- Reset personal overrides to Team Profile defaults.
- Preview the effective workspace before activation.
- Inspect why a capability is unavailable.

A profile switch should be transactional from the user's perspective: validate dependencies and layout first, then activate. If activation fails, retain or restore the previous working profile rather than leaving a partially configured workspace.

## 10. Initial implementation boundary

The first profile implementation should remain local and simple:

- Built-in default profile.
- Import/export of Team Profiles as versioned JSON.
- User overrides stored locally.
- Session overrides held separately.
- Plugin availability and compatibility checks.
- Profile-specific layout snapshots.

Do not build organization management, remote synchronization, profile collaboration or a marketplace as part of the first implementation. These can be added later if actual team distribution needs justify them.

## 11. Acceptance criteria

1. A user can import and activate a Team Profile.
2. A Team Profile can be shared without exporting credentials or local session data.
3. User overrides do not mutate the imported Team Profile.
4. The effective configuration is deterministic and explainable.
5. Missing plugins are reported without silently substituting another capability.
6. Profile import cannot grant permissions or bypass host policy.
7. A profile can restore a compatible workspace layout and recover from missing views.
8. A failed profile activation does not destroy the previous working workspace.
