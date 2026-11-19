# Plugin Architecture

**Status:** Proposed  
**Scope:** Architecture design only; no runtime implementation in this change  
**Target:** Architect Agent Desktop

## 1. Purpose

Architect Agent Desktop should support materially different ways of working without turning every team request into a permanent change to the desktop application's core. A research team, an engineering team, an operations team and an individual user may need different tools, context, workflows, panels and defaults while sharing the same desktop foundation.

The proposed direction is a **composable Agent Workspace**:

- The **Core Host** owns desktop lifecycle, trusted execution boundaries and stable platform services.
- **Plugins** contribute capabilities and extension points.
- **Profiles** select and configure a coherent set of capabilities for a role, team or individual.
- The **Workspace** presents selected capabilities through a configurable layout.
- **Policy** controls what may execute, independently of how a capability is presented or discovered.

This document describes a target architecture, not a claim that these mechanisms already exist.

## 2. Goals and non-goals

### Goals

1. Let different teams assemble different workspaces from reusable capabilities.
2. Let users switch between role-oriented workspaces without maintaining separate application builds.
3. Keep the core small: common lifecycle, IPC, storage, policy enforcement and extension contracts belong in the host.
4. Make extension installation, activation, failure and removal explicit and diagnosable.
5. Preserve the existing Electron security model: remote web content must not gain Node.js or unrestricted IPC access.
6. Allow gradual adoption. Existing built-in features can be wrapped as first-party extensions over time; a wholesale rewrite is not required.
7. Support local, single-user operation first. A centralized multi-user plugin marketplace or administration service is not a prerequisite.

### Non-goals

- Replacing the existing browser or redesigning its current behavior.
- Requiring every feature to become a plugin.
- Building a public plugin marketplace in the first iteration.
- Introducing a server-side multi-tenant plugin control plane.
- Treating plugin code as trusted merely because it is installed.
- Defining a universal extension standard for other desktop products.

## 3. Design principles

### 3.1 Core owns invariants; plugins own optional behavior

The host owns window lifecycle, trusted IPC, persistence primitives, capability authorization, plugin lifecycle and crash containment. A plugin owns the optional behavior it contributes.

A plugin must not patch internal host modules, reach into arbitrary renderer state, or directly control Electron objects owned by the host.

### 3.2 Capability and presentation are separate

A capability can exist without a panel. A panel can present one or more capabilities but cannot grant permission to execute them. Hiding a panel is not revoking a capability; showing a button is not authorization.

### 3.3 Profile is composition, not a fork

A profile references installed plugins and configures their contribution. It must not copy plugin source code or become a separate application build.

### 3.4 Explicit contracts over implicit discovery

Every extension declares identity, version, contribution types, dependencies, permissions, activation conditions and configuration schema. Runtime behavior must be attributable to a declared extension.

### 3.5 Progressive disclosure

The workspace should expose only the capabilities relevant to the active profile and task. The runtime may load metadata first and activate implementation code only when needed.

### 3.6 Secure by default

A plugin receives only the capabilities explicitly granted to it. The host remains the final authority for IPC, filesystem, process, network and consequential-action permissions.

## 4. Conceptual architecture

```text
+-------------------------------------------------------------+
|                    Workspace Experience                     |
|  Browser | Agent Panel | Plugin Panels | Tabs | Layout       |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|                  Profile & Composition                      |
|  Base Profile -> Team Profile -> User Overrides -> Session  |
|  Plugin selection | Configuration | Layout | Feature flags  |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|                    Plugin Runtime                           |
|  Manifest / Registry / Resolver / Lifecycle / Events         |
|  Agent | Tool | Skill | Workflow | UI | Context | Integration|
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|              Capability Registry & Policy Guard             |
|  Capability metadata | Permission checks | Audit events      |
|  Execution mediation | Confirmation requirements             |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|                        Core Host                             |
|  Electron Main | Preload / Typed IPC | Storage | Browser     |
|  Window lifecycle | Layout Engine | Diagnostics              |
+-------------------------------------------------------------+
```

The diagram is logical, not a process map. Actual execution placement is determined by extension type and trust level.

## 5. Extension contribution types

A plugin may contribute one or more extension types. These are contribution contracts, not separate package formats.

| Type | Responsibility | Example |
|---|---|---|
| Agent | Agent behavior, instructions, task entry points or agent-side orchestration | Investment research assistant |
| Tool | A callable operation with validated input/output | Read a selected local document |
| Skill | Reusable task knowledge, procedures and domain guidance | Research memo conventions |
| Workflow | A repeatable sequence of steps, approvals and outputs | Daily portfolio review |
| UI | Panels, views, commands and workspace entry points | Source comparison panel |
| Context | Domain context providers and scoped context sources | Team glossary or project context |
| Provider | A configured service endpoint or model connection supported by the host | A model endpoint configuration |
| Integration | Connection to an external application or service | Confluence or GitHub integration |

A plugin does not need to contribute every type. A UI-only plugin is valid; a tool plugin does not need a panel.

### 5.1 Skill, Tool and Plugin are different

- **Skill** describes how work should be done: instructions, domain knowledge, constraints and reusable procedures.
- **Tool** performs an operation: read, search, transform, navigate or invoke a service.
- **Plugin** packages and declares one or more contributions, dependencies, configuration and permissions.

A skill may reference tools, but the skill itself does not silently grant tool permissions. A plugin may package both a skill and tools, but each contribution remains separately identifiable and governable.

## 6. Plugin package and manifest

The initial package format should be a versioned directory or archive with a machine-readable manifest and optional assets. Avoid requiring a remote marketplace or complex package manager at the start.

Illustrative manifest (schema to be finalized during implementation):

```json
{
  "manifestVersion": "1",
  "id": "com.example.research-workspace",
  "name": "Research Workspace",
  "version": "1.0.0",
  "description": "Research tools and workspace panels",
  "contributes": {
    "agents": [],
    "tools": [],
    "skills": [],
    "workflows": [],
    "views": [],
    "contextProviders": [],
    "integrations": []
  },
  "dependencies": [],
  "permissions": [],
  "activationEvents": ["workspace.profileActivated"],
  "configuration": {}
}
```

Manifest requirements:

- Stable reverse-domain plugin identifier.
- Semantic version and supported manifest version.
- Explicit contribution identifiers and entry points.
- Declared dependencies and compatible version ranges.
- Declared permission requests, with human-readable reasons.
- Activation events and configuration schema.
- Optional integrity metadata for packaged distribution.
- No executable code embedded in metadata fields.

The host validates the manifest before registration. Invalid manifests are rejected with actionable diagnostics. Dependency resolution must detect missing dependencies, incompatible versions and cycles.

## 7. Runtime lifecycle

Recommended lifecycle:

1. **Discover** — locate built-in and user-installed plugin packages.
2. **Validate** — validate manifest, package structure, compatibility and integrity metadata.
3. **Resolve** — resolve dependencies and conflicts.
4. **Register** — register contribution metadata without necessarily executing implementation code.
5. **Authorize** — evaluate requested permissions against host policy and user grants.
6. **Activate** — load eligible contributions when their activation conditions are met.
7. **Execute** — invoke contributions through host-owned interfaces.
8. **Deactivate** — stop event subscriptions and release resources.
9. **Uninstall** — remove registration and package files, while handling plugin-owned data according to an explicit retention policy.

Lifecycle states should be observable: discovered, invalid, disabled, blocked, registered, active, failed and uninstall-pending. State transitions and failure reasons should be available in diagnostics.

A plugin failure should not take down the browser or the entire desktop application. The host should isolate failures by extension boundary, stop repeated failing activation attempts and provide a way to disable the plugin.

## 8. Execution and trust boundaries

The current application already separates Electron Main, Preload, Renderer and remote browser content. The plugin design must preserve and strengthen those boundaries.

| Extension surface | Preferred execution location | Constraints |
|---|---|---|
| Host services / privileged integration | Electron Main or a dedicated controlled process | Narrow host API; schema-validated IPC; explicit permissions |
| UI contribution | Local application Renderer, within a host-managed extension surface | No direct Electron API; no arbitrary access to other panels |
| Agent-side contribution | Existing agent execution boundary | Registered through explicit host interfaces; tool calls still pass policy |
| Untrusted third-party code | Isolated worker/process where technically feasible | No direct Main-process access; resource and communication limits |

The first implementation should prefer declarative contributions and host-provided adapters over arbitrary executable plugins. Where executable code is necessary, trust level and isolation requirements must be explicit.

Remote websites remain untrusted. They must never be treated as plugins and must not gain access to plugin APIs, host IPC or local files.

## 9. Capability registry and policy enforcement

All executable actions exposed to the Agent or workspace should be represented as registered capabilities. Each capability record should include:

- Stable capability ID and owning plugin ID.
- Contribution type and version.
- Input/output schema.
- Required permissions and resource scope.
- Execution adapter and timeout/resource limits.
- Availability state and activation requirements.
- Risk classification and confirmation requirement.
- Diagnostic metadata.

The registry answers **what is available**. The Policy Guard answers **whether this invocation is allowed**.

A capability invocation should follow this sequence:

```text
Caller
  -> Capability Registry (resolve ID and schema)
  -> Input validation
  -> Policy Guard (identity, scope, permission, risk)
  -> Optional user confirmation
  -> Host execution adapter
  -> Output validation and redaction
  -> Result + diagnostic event
```

The Agent, plugin and UI must not be the final authority on authorization. A plugin cannot grant itself permissions by changing its own metadata at runtime. UI visibility and Agent prompt instructions are not security controls.

For consequential operations, policy must distinguish read-only, reversible write and high-impact actions. The host should support deny, allow, allow-with-confirmation and policy-managed outcomes. The exact risk taxonomy is an implementation-stage contract.

## 10. Agent extension events

A host-owned event pipeline can support cross-cutting extensions without allowing arbitrary monkey-patching. Candidate events include:

- `session.created`
- `workspace.profileActivated`
- `agent.created`
- `agent.preStep`
- `agent.preToolExecute`
- `agent.postToolExecute`
- `agent.turnStopping`
- `agent.completed`

Event contracts must define payload schema, ordering, timeout, error behavior and whether a handler may modify the payload. Events should be typed and versioned.

Security decisions must not depend on ordinary plugin event handlers. In particular, a plugin hook cannot bypass or weaken the Policy Guard. Policy checks are mandatory host-controlled steps around capability execution.

## 11. Workspace UI extensions and Layout Engine

The Layout Engine is a host platform service, not a feature implemented independently by each UI plugin.

A UI plugin declares a view contribution: ID, title, icon, preferred placement, minimum size, supported states and activation requirements. The host decides where and how that view is mounted.

The Layout Engine owns:

- Dock regions and split layout.
- Tab groups and panel activation.
- Minimize, maximize, undock and restore behavior.
- Minimum/maximum constraints and responsive bounds.
- Snapshot creation, validation, migration and restoration.
- Layout persistence per profile and workspace.
- Recovery when a view is missing, disabled or fails to mount.

Plugins must not directly set Electron `WebContentsView` bounds, mutate other panels or own global window geometry. They request layout changes through a typed host API. The host remains the sole authority that translates layout state into Electron bounds.

Snapshots should be versioned and declarative. They store view IDs, placement, sizes, active tabs and layout relationships—not live object references or executable state. Restore must tolerate removed plugins and unknown view IDs by preserving recoverable state and falling back to a safe default layout.

## 12. Profile composition

Profiles select plugin contributions and configure their behavior. The proposed precedence is:

```text
Built-in Defaults
      -> Organization / Shared Baseline (optional future)
          -> Team Profile
              -> User Overrides
                  -> Session Overrides (temporary)
```

The first local release can support built-in defaults, imported Team Profiles, user overrides and session overrides. An organization-level remote service is optional future work.

Merge rules:

1. A higher layer may override ordinary configuration values when the schema permits it.
2. A higher layer may enable only plugins that are installed and permitted by host policy.
3. Security restrictions and mandatory confirmations cannot be weakened by a lower layer.
4. Missing or incompatible plugins are reported; they are not silently substituted.
5. Session overrides are temporary and do not rewrite the saved Team Profile.
6. The effective profile must be inspectable, including the source layer for each resolved value.

Profile composition is specified in the companion document `PROFILE-COMPOSITION.md`.

## 13. Configuration and persistence

Separate data by ownership:

- **Application settings:** window behavior, trusted host settings and global preferences.
- **Plugin registry:** installed package metadata, version, enabled state and grants.
- **Plugin configuration:** schema-validated settings scoped to the relevant profile or user.
- **Profile definitions:** plugin selection, configuration overlays and layout references.
- **Workspace state:** current session and recoverable layout snapshot.
- **Plugin data:** explicitly namespaced plugin-owned data with lifecycle and deletion rules.

A plugin must not write arbitrary files into host-owned configuration directories. The host provides scoped storage APIs. Secrets should be stored using an appropriate OS-backed secret store where available; they must not be serialized into profile exports.

## 14. Diagnostics and observability

Every plugin lifecycle transition and capability invocation should produce structured diagnostic events with correlation IDs. At minimum capture plugin ID/version, contribution ID, profile ID, lifecycle stage, outcome, duration and sanitized error information.

Do not log secrets, raw credentials or sensitive document content by default. Diagnostics are for troubleshooting and operational traceability; they do not replace authorization or user confirmation.

The UI should expose:
- Installed and enabled plugins.
- Plugin health and activation errors.
- Requested and granted permissions.
- Profile-to-plugin contribution mapping.
- Capability availability and invocation failures.
- Layout recovery warnings.

## 15. Delivery plan

### Phase 0 — Architecture and contracts
- Agree on plugin vocabulary, manifest shape, trust boundaries and profile model.
- Document lifecycle states, policy responsibilities and layout ownership.
- No code changes in this phase.

### Phase 1 — Registry foundation
- Manifest validation and plugin registry.
- Built-in plugin registration.
- Enable/disable state and lifecycle diagnostics.
- No arbitrary third-party executable code.

### Phase 2 — Profile composition
- Profile schema, validation and deterministic merge rules.
- Built-in and imported Team Profiles.
- Profile-scoped plugin configuration and layout references.

### Phase 3 — Capability and policy
- Capability registry and host invocation adapter.
- Permission declarations and Policy Guard.
- Structured invocation diagnostics and confirmation flow.

### Phase 4 — Agent contributions
- Register existing Agent tools and skills through contribution contracts where useful.
- Add typed lifecycle events with bounded handlers.
- Preserve the existing Agent integration behavior.

### Phase 5 — Workspace UI contributions
- Host-managed view slots backed by the Layout Engine.
- Versioned layout snapshots and profile-specific restoration.
- Built-in panels migrated incrementally.

### Phase 6 — External integrations and distribution
- Integration adapters, package import/export, compatibility checks and integrity validation.
- Optional plugin catalog and shared Team Profile distribution.

Each phase should be independently shippable. Do not introduce a marketplace, remote control plane or arbitrary code execution before the local registry, policy and lifecycle foundations are proven.

## 16. Acceptance criteria for the target architecture

The architecture is considered realized when:

1. A Team Profile can select a coherent set of installed capabilities and layout contributions.
2. Two profiles can present meaningfully different workspaces without separate application builds.
3. A plugin can be disabled without breaking unrelated core functionality.
4. The host can explain why a plugin or capability is unavailable.
5. Every executable capability is resolved and authorized through host-controlled policy.
6. UI plugins cannot manipulate Electron view bounds or access privileged APIs directly.
7. Layout snapshots can be restored after a plugin is removed or a view becomes unavailable.
8. Profile imports cannot silently grant additional privileges.
9. Plugin errors are diagnosable and do not crash the whole workspace.
10. The browser's existing remote-content isolation remains intact.

## 17. Open design questions

These should be resolved before the corresponding implementation phase, not guessed prematurely:

- Which extension types require executable code versus declarative data?
- What isolation mechanism is practical for each supported plugin type?
- Should plugin packages be imported as directories, archives or both?
- What is the exact compatibility policy for host and manifest versions?
- Which profile fields are user-overridable, and which are locked by policy?
- What layout snapshot migration guarantees are required across releases?
- Which plugin-owned data is retained or deleted on uninstall?

## 18. References

- DeepSeek Harness repository: https://github.com/deepseek-ai/deepseek-harness/
- DeepSeek Harness reference: https://deepseek-harness.github.io/deepseek-harness/en/reference/
- DeepSeek Harness extension cookbook: https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook
- DeepSeek Harness plugin manager: https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/boot/plugin-manager
- Architect Agent Desktop: https://github.com/saga/architect-agent-desktop

These references are inspiration for extension lifecycle and composition patterns. This proposal intentionally defines contracts around Architect Agent Desktop's Electron host, workspace and security boundaries rather than copying another project's runtime wholesale.
