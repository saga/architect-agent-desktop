# ADR-004: Rust/WASI Generated Code Backend

- Status: Accepted
- Date: 2026-11-20

## Context

The desktop application has a Native UtilityProcess runtime for trusted local Skills and a JavaScript Code Mode that orchestrates brokered tools. UtilityProcess is process and fault isolation, not an OS security sandbox: generated JavaScript can technically access Node.js APIs directly.

The separate `saga/desktop-agent` implementation provides Rust-to-WASI Preview 1 execution using MXC for host process containment and Wasmer for guest execution. This backend must be integrated without replacing Architect Agent Desktop's existing Agent Runtime, browser tools, permission model, Trace flow or trusted Skill execution.

## Decision

Add an independent Rust/WASI backend exposed through two Agent tools:

1. `execute_rust` validates source and JSON input, compiles a fixed Cargo template and local SDK to `wasm32-wasip1`, runs the WASI module with Wasmer Singlepass inside MXC and returns a staged workspace diff.
2. `apply_rust_changes` revalidates the stored diff, workspace hashes and target paths, then applies the exact staged changes.

The Rust backend runs in an external Node.js 24+ helper process using `@microsoft/mxc-sdk`. It is not hosted inside the UtilityProcess. The helper does not expose its host-shell tool to the Agent.

Rust tools are exposed only in Allow all mode, with a selected workspace and valid platform-matched resources. Linux and missing or mismatched resources fail closed. Supported release targets are macOS ARM64, macOS x64 and Windows x64.

The existing UtilityProcess runtime and JavaScript `execute_code` behavior remain unchanged. The latter remains non-sandboxed process execution and must not be described as a secure boundary.

## Security properties and limitations

- Generated Rust uses a fixed Cargo manifest, lockfile, SDK and template; model input supplies only the agent module and JSON task input.
- Cargo runs offline. The fixed project and SDK policy constrain arbitrary dependencies, build scripts and unsafe code.
- Workspace data is staged with symlinks, hardlinks, special files, credential directories and common build/dependency directories excluded.
- Wasmer uses the Singlepass backend with network disabled and only the staged workspace volume. The Rust linker caps linear memory at 256 MiB; MXC enforces the process timeout.
- Workspace writes are separated from execution. Apply checks the stored diff, current workspace hashes, staged hashes and path safety.
- Resource manifests bind platform/architecture and hashes of critical binaries and source resources.
- MXC is not a VM. Windows ProcessContainer is not equivalent to AppContainer, Hyper-V isolation or a micro-VM. Effective isolation depends on MXC backend availability and host policy.
- Apply is gated by Allow all; this change does not add a separate per-diff confirmation dialog.
- CI packaging and WASI smoke tests do not prove sandbox escape resistance. Validation on real supported OS installations remains required.

## Consequences

The change is additive and preserves the existing Runtime and browser/Agent tool architecture. Packaging requires a native Rust toolchain with `wasm32-wasip1`, Wasmer CLI 7.3.0+ and an external Node.js runtime for MXC (24+ on macOS; 24.21.0+ or 26.8.0+ on Windows). Unsigned CI installers are test artifacts, not signed releases.
