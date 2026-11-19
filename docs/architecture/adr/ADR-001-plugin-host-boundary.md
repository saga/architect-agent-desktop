# ADR-001: Host-Owned Plugin Lifecycle and Extension Contracts

**Status:** Proposed  
**Date:** 2026-11-19

## Context

Different teams need different capabilities and UI contributions. Implementing each request directly in core application code creates a growing set of team-specific branches and tightly coupled features. At the same time, arbitrary plugin code must not gain control of Electron internals or the application lifecycle.

## Decision

Introduce a host-owned plugin model with explicit manifests, contribution contracts, registry and lifecycle.

The host owns discovery, validation, dependency resolution, registration, authorization, activation, deactivation, failure handling and uninstall. Plugins declare contributions and request permissions; they do not control host lifecycle.

A plugin may contribute one or more of Agent, Tool, Skill, Workflow, UI, Context, Provider or Integration capabilities. These contribution types are independently identifiable and do not imply that every plugin has a UI or executable component.

## Consequences

Positive:
- Team-specific capabilities can be packaged and reused.
- The host has one place to validate compatibility and observe plugin health.
- Built-in features can migrate incrementally without a wholesale rewrite.

Trade-offs:
- Manifest and lifecycle contracts require versioning and compatibility management.
- Extension failures and dependency conflicts need explicit UX and diagnostics.
- The host must maintain stable APIs for supported contributions.

## Constraints

- Plugins cannot patch host internals or directly invoke arbitrary Electron APIs.
- Plugin metadata is validated before registration.
- Failure of one plugin must not terminate the entire workspace.
- No public marketplace is required by this decision.
