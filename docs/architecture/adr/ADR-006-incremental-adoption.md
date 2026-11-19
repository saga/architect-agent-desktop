# ADR-006: Adopt the Architecture Incrementally and Local-First

**Status:** Proposed  
**Date:** 2026-11-19

## Context

The current application is an actively evolving desktop browser and Agent workspace. A large rewrite or an early centralized plugin service would introduce risk before the extension model has proven useful.

## Decision

Adopt the target architecture in independently shippable phases, beginning with contracts and a local registry. Support local plugin discovery and Team Profile import/export before considering remote catalogs, centralized administration or multi-user services.

Migrate existing features only when doing so creates a clear benefit. Existing browser and Agent behavior should remain stable during the transition.

## Consequences

Positive:
- The design can be validated against real team workflows before building distribution infrastructure.
- Each phase has a smaller failure surface.
- The application remains useful without a marketplace or remote service.

Trade-offs:
- Some built-in features may temporarily coexist with plugin-based features.
- Migration requires compatibility adapters and clear ownership boundaries.
- Team distribution may initially rely on files and source control.

## Constraints

- No code changes are included in the architecture-documentation phase.
- No marketplace or remote multi-tenant control plane is a prerequisite.
- Do not refactor stable existing functionality solely to achieve theoretical uniformity.
