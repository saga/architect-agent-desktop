# ADR-004: Layout Engine Owns Workspace Geometry and Snapshots

**Status:** Proposed  
**Date:** 2026-11-19

## Context

As the workspace grows beyond a fixed browser and agent panel, teams may need different panel arrangements, tab groups, dock regions and task-specific views. If each UI plugin controls its own Electron bounds, layout behavior becomes inconsistent and fragile.

## Decision

The Layout Engine is a core host service. UI plugins declare view contributions and constraints; they do not manipulate Electron `WebContentsView` bounds or other panels directly.

The Layout Engine owns docking, splitting, tab grouping, activation, maximize/undock, constraints, snapshot persistence, migration and restoration. Snapshots are versioned declarative data containing view IDs and layout relationships, not live object references or executable state.

## Consequences

Positive:
- Layout behavior remains consistent across built-in and plugin panels.
- Profiles can select and restore workspace arrangements.
- The host can recover from missing or failed UI contributions.

Trade-offs:
- The Layout Engine becomes a foundational platform component with a stable contract.
- Snapshot schema migration and fallback behavior must be tested.
- Plugins must use host APIs for layout requests.

## Constraints

- Plugins cannot set native view bounds directly.
- A snapshot cannot grant permissions or execute code.
- Unknown or unavailable view IDs must not prevent the rest of a layout from restoring.
