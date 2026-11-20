import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExecutable, discoverRustToolchain } from "../scripts/rust-toolchain-discovery.mjs";

const temporary = [];
function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-toolchain-discovery-"));
  temporary.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Rust/WASM toolchain discovery", () => {
  it("finds Rust tools under the conventional CARGO_HOME/bin directory", () => {
    const home = tempDir();
    const cargoHome = path.join(home, "cargo");
    fs.mkdirSync(path.join(cargoHome, "bin"), { recursive: true });
    fs.writeFileSync(path.join(cargoHome, "bin", "rustc"), "");
    const found = findExecutable("rustc", { home, env: { CARGO_HOME: cargoHome, PATH: "" }, platform: "linux" });
    expect(found).toBe(path.join(cargoHome, "bin", "rustc"));
  });

  it("uses the active rustc sysroot and verifies wasm32-wasip2", () => {
    const home = tempDir();
    const cargoHome = path.join(home, "cargo");
    const shimDir = path.join(cargoHome, "bin");
    const sysroot = path.join(home, "toolchain");
    const targetLibrary = path.join(sysroot, "lib", "rustlib", "wasm32-wasip2", "lib");
    fs.mkdirSync(shimDir, { recursive: true });
    fs.mkdirSync(path.join(sysroot, "bin"), { recursive: true });
    fs.mkdirSync(targetLibrary, { recursive: true });
    fs.writeFileSync(path.join(shimDir, "rustc"), "");
    const rustc = path.join(sysroot, "bin", "rustc");
    const cargo = path.join(sysroot, "bin", "cargo");
    fs.writeFileSync(rustc, "");
    fs.writeFileSync(cargo, "");
    const result = discoverRustToolchain({
      home,
      platform: "linux",
      env: { CARGO_HOME: cargoHome, PATH: "" },
      execFileSync: (_command, args) => args[0] === "--print" && args[1] === "sysroot" ? sysroot : targetLibrary,
    });
    expect(result).toEqual({ toolchain: sysroot, rustc, cargo, targetLibrary });
  });
});
