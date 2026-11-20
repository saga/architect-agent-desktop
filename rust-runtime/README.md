# Wasmtime source build

The desktop package currently consumes the Wasmtime CLI executable. A Cargo manifest added to the Electron root would not change the dependencies already compiled into a downloaded Wasmtime binary.

The build therefore uses the official Wasmtime source workspace as the Cargo project. Its own `Cargo.toml` and `Cargo.lock` are authoritative:

- Source repository: `https://github.com/bytecodealliance/wasmtime`
- Tag: `v50.0.2`
- Source commit: `f9a93b049a23bef9a33cfa3888f32af33a178749`
- Wasmtime version: `50.0.2`
- Locked `cranelift-frontend`: `0.137.2`

The source tag pins Cranelift as a local workspace crate (the manifest uses a path dependency), so changing only a standalone Cargo dependency declaration or adding a direct dependency in the Electron repository would not override it. To change the Cranelift version independently, the Wasmtime source workspace itself must be patched and validated.

Run:

```bash
npm run build:wasmtime
```

The build script checks the upstream lockfile before compiling and writes the executable plus a build manifest to `.cache/wasmtime/`. The directory is ignored by Git and is discovered automatically by the Rust sandbox packaging script.

CI performs this source build natively on each supported target before packaging. The build manifest records the exact upstream commit, Wasmtime version, Cranelift version and executable SHA-256. This is a reproducible source-build record, not a substitute for a generated SBOM or the organization's Sonar scan.
