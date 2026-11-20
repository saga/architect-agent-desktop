import test from "node:test";
import assert from "node:assert/strict";
import {
  RUST_SOURCE_LIMIT,
  WASM_MEMORY_LIMIT,
  buildWasmerArgs,
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

test("Wasmer runs WASI Preview 1 with the Singlepass backend and a single workspace volume", () => {
  const args = buildWasmerArgs("/bundle/wasmer", "/tmp/run/workspace", "/tmp/run/task.wasm");
  assert.equal(args[0], "/bundle/wasmer");
  assert.deepEqual(args.slice(1, 4), ["run", "--singlepass", "--disable-cache"]);
  assert.ok(args.includes("--volume"));
  assert.ok(args.includes("/tmp/run/workspace:/workspace"));
  assert.ok(args.includes("--stack-size"));
  assert.ok(args.includes("1048576"));
  assert.equal(args.at(-1), "/tmp/run/task.wasm");
  assert.equal(WASM_MEMORY_LIMIT, 256 * 1024 * 1024);
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
