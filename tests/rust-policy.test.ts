import test from "node:test";
import assert from "node:assert/strict";
import {
  RUST_SOURCE_LIMIT,
  WASM_FUEL_LIMIT,
  WASM_MEMORY_LIMIT,
  WASM_RUN_TIMEOUT_MS,
  WASM_STACK_LIMIT,
  buildWasmSandboxOptions,
  compareFileHashes,
  isExcludedWorkspaceEntry,
  isSafeRelativePath,
  validateRustInput,
  validateRustSource,
} from "../src/main/sandbox/rust-policy.mjs";

test("Rust source and input have strict size and shape limits", () => {
  assert.equal(validateRustSource("pub fn run() {}"), "pub fn run() {}");
  assert.throws(() => validateRustSource(" "), /non-empty/);
  assert.throws(() => validateRustSource("x".repeat(RUST_SOURCE_LIMIT + 1)), /64 KiB/);
  assert.equal(validateRustInput({ task: "test" }), '{"task":"test"}');
  assert.throws(() => validateRustInput([]), /JSON object/);
});

test("workspace paths reject absolute paths, traversal, empty segments and drive prefixes", () => {
  assert.equal(isSafeRelativePath("src/main.rs"), true);
  assert.equal(isSafeRelativePath(".config/settings.json"), true);
  assert.equal(isSafeRelativePath("../secret"), false);
  assert.equal(isSafeRelativePath("src/../secret"), false);
  assert.equal(isSafeRelativePath("/etc/passwd"), false);
  assert.equal(isSafeRelativePath("C:\\\\Users\\\\secret"), false);
  assert.equal(isSafeRelativePath("src//main.rs"), false);
  assert.equal(isSafeRelativePath("src\\\\main.rs"), false);
  assert.equal(isSafeRelativePath("src/C:secret"), false);
});

test("snapshot excludes credentials, dependency trees and build output", () => {
  for (const name of [".git", ".ssh", ".aws", "node_modules", "target", ".desktop-agent", ".env", ".env.local", ".npmrc", ".config", ".local", ".rustup", ".cargo", ".mozilla", "Library", "AppData", "Keychains", "secrets", "credentials.json", "id_rsa", "private.pem", "private.PEM", "identity.P12", "SSH_HOST_RSA_KEY"]) {
    assert.equal(isExcludedWorkspaceEntry(name, false), true, name);
  }
  assert.equal(isExcludedWorkspaceEntry("src", true), false);
  assert.equal(isExcludedWorkspaceEntry("package.json", false), false);
});

test("WASM Sandbox receives only the staged workspace and explicit resource quotas", () => {
  const options = buildWasmSandboxOptions("/tmp/run/task.wasm", "/tmp/run/workspace");
  assert.equal(options.wasmFile, "/tmp/run/task.wasm");
  assert.equal(options.programName, "desktop_agent_task");
  assert.deepEqual(options.mapDirs, [{ key: "/tmp/run/workspace", value: "/workspace" }]);
  assert.deepEqual(options.allowedOutboundHosts, []);
  assert.equal(options.wasmTimeout, WASM_RUN_TIMEOUT_MS / 1000);
  assert.equal(options.wasmMaxMemorySize, WASM_MEMORY_LIMIT);
  assert.equal(options.wasmMaxWasmStack, WASM_STACK_LIMIT);
  assert.equal(options.wasmFuel, WASM_FUEL_LIMIT);
  assert.equal(options.workDir, undefined);
});

test("file diff distinguishes added, modified and deleted paths", () => {
  const before = new Map([["same.txt", "a"], ["edit.txt", "b"], ["gone.txt", "c"]]);
  const after = new Map([["same.txt", "a"], ["edit.txt", "changed"], ["new.txt", "d"]]);
  assert.deepEqual(compareFileHashes(before, after), [
    { path: "edit.txt", status: "modified" },
    { path: "gone.txt", status: "deleted" },
    { path: "new.txt", status: "added" },
  ]);
});
