# ADR-005: Plugin Execution Follows Explicit Trust Boundaries

**Status:** Proposed  
**Date:** 2026-11-19

## Context

Electron applications contain privileged Main-process code, a local Renderer, Preload bridges and remote web content. A plugin architecture increases the amount of extensible behavior and must not collapse these security boundaries.

## Decision

Assign execution placement and available APIs by contribution type and trust level. Prefer declarative contributions and host-provided adapters. Where executable code is necessary, run it in the narrowest feasible isolated boundary and expose only explicit host APIs.

Privileged operations remain in host-controlled services. Renderer contributions do not receive raw Electron APIs. Remote browser content remains untrusted and is never treated as a plugin.

## Consequences

Positive:
- Plugin extensibility does not require exposing unrestricted host privileges.
- Permission requests can be reviewed and mediated centrally.
- The host can contain failures and apply resource limits at execution boundaries.

Trade-offs:
- Isolation and communication contracts add engineering work.
- Some plugin types may have narrower capabilities than first-party built-ins.
- The supported trust model must be documented before third-party executable plugins are enabled.

## Constraints

- No arbitrary Node.js access from plugin UI.
- No raw IPC access; use typed, validated host APIs.
- No plugin access to remote page internals beyond explicitly mediated browser capabilities.
- Installation does not imply trust or permission approval.
