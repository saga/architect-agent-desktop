# Architecture Decision Records

This directory records decisions for the proposed plugin and profile architecture of Architect Agent Desktop.

These ADRs are **proposed** and describe design intent only. They do not indicate that the corresponding implementation exists.

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](./ADR-001-plugin-host-boundary.md) | Host-owned plugin lifecycle and extension contracts | Proposed |
| [ADR-002](./ADR-002-profile-composition.md) | Profiles compose plugins and workspace configuration | Proposed |
| [ADR-003](./ADR-003-capability-policy-separation.md) | Capability discovery is separate from authorization | Proposed |
| [ADR-004](./ADR-004-layout-engine-ownership.md) | Layout Engine owns workspace geometry and snapshots | Proposed |
| [ADR-005](./ADR-005-plugin-trust-and-execution.md) | Plugin execution follows explicit trust boundaries | Proposed |
| [ADR-006](./ADR-006-incremental-adoption.md) | Adopt the architecture incrementally, local-first | Proposed |

## Decision scope

The records cover plugin lifecycle, profile composition, capability governance, UI/layout ownership, trust boundaries and rollout strategy.

They intentionally do not decide changes to the current Agent SDK integration or Agent Framework selection. Those topics are outside this design package.
