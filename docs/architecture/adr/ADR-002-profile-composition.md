# ADR-002: Profiles Compose Plugins and Workspace Configuration

**Status:** Proposed  
**Date:** 2026-11-19

## Context

Different teams and individual users require different combinations of tools, skills, workflows, context and panels. Separate application builds or hard-coded team modes would make these variations expensive to maintain.

## Decision

Use a versioned Profile as the composition unit for a working environment. A profile selects installed plugins and contributions, supplies schema-validated configuration, references a workspace layout and may define task presets.

The target layering is Built-in Defaults -> optional Organization Baseline -> Team Profile -> User Overrides -> Session Overrides.

The first local implementation may omit the Organization Baseline and use import/export for Team Profiles. Security policy and permission grants are not profile configuration and cannot be weakened by profile layers.

## Consequences

Positive:
- Teams can share a workspace definition without distributing a separate application.
- Personal preferences can coexist with team conventions.
- Profiles can be inspected, versioned and exchanged as files.

Trade-offs:
- Merge semantics and schema compatibility must be explicit.
- Missing plugins and failed activation need visible recovery behavior.
- Profile portability requires strict exclusion of secrets and local runtime state.

## Constraints

- Importing a profile does not install arbitrary code or grant permissions.
- Session overrides do not silently modify saved profiles.
- The effective profile must identify the source layer for resolved settings.
