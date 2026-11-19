# ADR-002: Simple Team Profiles with Local Overrides

**Status:** Proposed  
**Date:** 2026-11-19

## Context

Different teams need different workspace defaults, while individuals need to retain personal preferences. A layered inheritance and generic merge system would add complexity without a current need for centralized administration.

## Decision

Use a simple Profile JSON document to select installed plugins, provide non-secret plugin configuration and optionally reference a saved Layout Engine layout.

The initial precedence is limited to built-in defaults, one active Team Profile and local user overrides. Session-only changes are temporary. No organization layer, nested inheritance or remote synchronization is required.

The Layout Engine remains the owner of layout schema and persistence. Profiles reference layouts rather than defining a parallel representation.

## Consequences

- Team workspaces can be shared as files and version-controlled externally.
- Profile resolution remains deterministic and easy to explain.
- Security permissions, approval decisions, credentials and secrets are never profile configuration.
- More complex inheritance or merge semantics require evidence from real usage before being added.
