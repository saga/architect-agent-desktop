# ADR-003: Capability Discovery Is Separate from Authorization

**Status:** Proposed  
**Date:** 2026-11-19

## Context

The Agent and workspace need to discover available operations contributed by built-in features and plugins. Availability, visibility and permission are different concerns. If a prompt, plugin or UI component can decide whether an operation is authorized, the security boundary becomes mutable by the extension being governed.

## Decision

Maintain a host-owned Capability Registry for discovery and resolution, and a separate host-owned Policy Guard for authorization.

Each executable capability declares identity, owner, schema, required permissions, scope, risk classification and execution adapter. Invocations are resolved, validated and authorized before execution. Consequential operations may require user confirmation according to host policy.

## Consequences

Positive:
- Capabilities can be discovered consistently across UI and Agent entry points.
- Authorization remains independent of plugin implementation and presentation.
- Invocation diagnostics can identify the capability and owning plugin.

Trade-offs:
- Capability metadata and policy contracts need lifecycle and version management.
- The host must mediate every executable invocation.
- Risk classification and confirmation UX need careful definition.

## Constraints

- A plugin cannot grant itself permissions.
- Hiding a UI element does not revoke a capability; showing it does not authorize execution.
- Agent instructions and plugin hooks are not security boundaries.
- Policy checks cannot be bypassed by ordinary extension events.
