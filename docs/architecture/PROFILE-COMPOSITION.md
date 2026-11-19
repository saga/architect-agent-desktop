# Workspace Profiles

**Status:** Proposed  
**Related:** [Plugin Architecture](./PLUGIN-ARCHITECTURE.md)

## 1. Purpose

A Profile describes a working environment for a team or an individual. It selects installed plugins and supplies defaults; it is not a separate application build and does not contain executable code.

Examples include a Research Team profile with research skills and panels, or an Engineering profile with repository tools and code-review workflows.

## 2. Initial profile model

Keep the first version to three sources:

1. **Built-in defaults** shipped with the application.
2. **One active Team Profile** imported as a JSON file.
3. **Local user overrides** for personal preferences and layout.

Temporary session changes may exist in memory, but are not persisted unless the user explicitly saves them.

Do not add organization baselines, nested profile inheritance or a general-purpose multi-layer composition engine yet.

A profile contains:
- Schema version, ID, name and description.
- IDs of plugins to enable.
- Non-secret plugin configuration.
- Optional reference to a saved workspace layout.

Example:

```json
{
  "schemaVersion": 1,
  "id": "team.research",
  "name": "Research Team",
  "plugins": ["team.research-tools", "team.document-workflow"],
  "configuration": {
    "team.research-tools": {
      "defaultOutput": "research-brief"
    }
  },
  "layout": "research.default"
}
```

The schema should stay small and evolve only when actual profile use cases require more fields.

## 3. Resolution rules

Use predictable, shallow rules rather than a generic merge framework:

- The active Team Profile selects the enabled plugin set.
- Local user preferences override only fields explicitly designated as user-configurable, such as theme, panel size and personal shortcuts.
- A user cannot override host security rules, grant tool permissions or place secrets in a profile.
- Plugin configuration is replaced as a unit unless a specific field has a demonstrated need for merging.
- Unknown plugin IDs or unsupported schema versions are reported; they are not silently substituted.

The application should show which profile is active and identify missing or incompatible plugins. It does not need a per-field provenance inspector in the first version.

## 4. Import and export

Import:
1. Parse and validate the JSON.
2. Show the profile name and missing/unsupported plugins.
3. Let the user choose whether to activate it.
4. Keep the current working profile if validation or activation fails.

Export:
- Include profile metadata, plugin IDs, non-secret configuration and the selected layout.
- Exclude credentials, tokens, private keys, local absolute paths and transient session state.
- Do not export permission grants or approval decisions.

Importing a profile never installs executable code or grants permissions.

## 5. Layout

A profile may select a layout saved by the existing Layout Engine. Layout data remains owned and validated by that engine; profiles should reference it rather than define another layout schema.

Personal layout changes are stored locally and do not modify the imported Team Profile unless the user explicitly exports an updated profile.

## 6. Initial acceptance criteria

- Import and activate a Team Profile from a JSON file.
- Export a profile without secrets or machine-local state.
- Keep local preferences separate from the shared profile.
- Report missing plugins and unsupported profile versions.
- Reject attempts to configure permissions or secrets through a profile.
- Failed profile activation leaves the previous workspace usable.
