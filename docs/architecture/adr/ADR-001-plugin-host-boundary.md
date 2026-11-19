# ADR-001: Declarative Plugin Packages Owned by the Host

**Status:** Proposed  
**Date:** 2026-11-19

## Context

Teams need different combinations of skills, tools, workflows and workspace views. Hard-coded team modes or separate application builds would make these differences expensive to maintain. A general-purpose executable plugin runtime would add substantial security and lifecycle complexity before it is needed.

## Decision

Use local, declarative plugin packages. A package contains a small manifest and optional resource files, and may contribute skills, references to host-supported tools, workflow definitions and host-supported view declarations.

The Host owns package import, validation, registration, enable/disable and removal. Plugins do not run arbitrary code, patch host internals or control Electron objects.

Tool references resolve to existing host tools. All execution and permission checks remain in the application's existing host-controlled path; the plugin system does not introduce a second tool runtime or authorization framework.

## Consequences

- Teams can share capability bundles without separate application builds.
- The initial implementation is limited to manifest validation and local package management.
- Arbitrary executable plugins, dependency resolution, event hooks and marketplace infrastructure are explicitly out of scope until justified by a concrete requirement.
- Existing features are migrated only when doing so provides a practical benefit.
