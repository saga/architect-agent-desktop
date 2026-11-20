# ADR-004: Rust/WASI Generated Code Backend

**Status:** Accepted; cross-platform integration and sandbox validation required.

## Context

The desktop application has a Native UtilityProcess runtime for trusted local Skills and a JavaScript Code Mode that orchestrates brokered tools. UtilityProcess is process and fault isolation, not an OS security sandbox: generated JavaScript can technically access Node.js APIs directly.

Generated Rust needs a distinct execution path. The existing Rust/WASI design compiles a fixed Cargo project and SDK, stages a copy of the selected workspace, and applies changes only after an explicit Snapshot/Diff approval.

## Decision

1. Keep `execute_rust` and `apply_rust_changes` as separate Agent tools.
2. Compile generated Rust directly to a WASI Preview 2 Component with Rust's `wasm32-wasip2` target. No `wasm-bindgen`, `cargo-component` or post-build Component conversion is required.
3. Execute the Component with the pinned `@wasm-sandbox/runtime@1.3.0` package inside the existing MXC helper process.
4. Run the synchronous native runtime call in a dedicated Node child process launched through MXC. The MCP helper remains responsive to cancellation messages, and MXC owns the child process timeout, termination and output capture.
5. Grant the Component only one host directory mapping: the staged workspace at `/workspace`. Do not set a guest root directory or grant outbound hosts.
6. Enforce 256 MiB guest linear memory, 8 MiB stack, 100 million fuel units and a 60-second runtime deadline. Keep MXC as the outer OS process boundary with network egress denied.
7. Preserve the current source/input validation, workspace snapshot, file hash checks, diff generation and explicit apply workflow. JavaScript `execute_code` remains unchanged.

## Consequences

The Rust compiler, Cargo, SDK and template remain packaged under `resources/rust-sandbox`. The runtime and its platform-specific N-API binary are pinned npm dependencies and unpacked from ASAR. The runtime package exposes a synchronous `run()` API, so a separate child process is required for responsive cancellation and output capture.

The native package is young and its public repository currently publishes platform binaries and JavaScript wrappers without the Rust implementation source. This limits independent review of the native sandbox implementation and is a supply-chain/auditability risk. Pin the exact version and npm integrity, retain MXC as an outer boundary, and do not treat package documentation alone as proof of escape resistance.

CI must test macOS ARM64, macOS x64 and Windows x64 package installation and execute a real Rust-produced Component through the packaged runtime. The smoke test does not replace escape-resistance testing on supported OS installations. Unsigned CI installers remain test artifacts, not signed releases.
