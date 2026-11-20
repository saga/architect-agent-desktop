import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function executableSuffixes(name, platform, pathext = ".EXE;.CMD;.BAT") {
  if (platform !== "win32" || path.extname(name)) return [""];
  return pathext.split(";").filter(Boolean).flatMap(ext => [ext.toLowerCase(), ext.toUpperCase()]);
}

export function findExecutable(name, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  const explicit = name === "rustc" ? env.RUSTC : name === "cargo" ? env.CARGO : undefined;
  const cargoHome = env.CARGO_HOME || path.join(home, ".cargo");
  const directories = [
    ...(name === "wasmtime" && env.WASMTIME_HOME ? [path.join(env.WASMTIME_HOME, "bin"), env.WASMTIME_HOME] : []),
    ...((name === "rustc" || name === "cargo") ? [path.join(cargoHome, "bin"), path.join(home, ".cargo", "bin")] : []),
    ...(name === "wasmtime" ? [path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache", "wasmtime", "bin")] : []),
    ...(env.PATH || "").split(delimiter).filter(Boolean),
    ...(name === "wasmtime" ? [path.join(home, ".wasmtime", "bin")] : []),
  ];
  const candidates = explicit ? [explicit] : [];
  for (const directory of [...new Set(directories)]) {
    for (const suffix of executableSuffixes(name, platform, env.PATHEXT)) candidates.push(path.join(directory, name + suffix));
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch { /* try next conventional location */ }
  }
  return undefined;
}

export function discoverRustToolchain(options = {}) {
  const run = options.execFileSync ?? execFileSync;
  const platform = options.platform ?? process.platform;
  const extension = platform === "win32" ? ".exe" : "";
  const candidate = findExecutable("rustc", options);
  if (!candidate) throw new Error("Rust compiler not found. Install Rust with rustup and ensure rustc/cargo are on PATH, or configure CARGO_HOME.");
  const sysroot = run(candidate, ["--print", "sysroot"], { encoding: "utf8" }).trim();
  if (!sysroot) throw new Error("rustc did not report its active toolchain sysroot.");
  const rustc = path.join(sysroot, "bin", "rustc" + extension);
  const cargoInSysroot = path.join(sysroot, "bin", "cargo" + extension);
  const cargo = fs.existsSync(cargoInSysroot) ? cargoInSysroot : findExecutable("cargo", options);
  if (!fs.existsSync(rustc)) throw new Error("The active Rust sysroot does not contain rustc: " + rustc);
  if (!cargo) throw new Error("Cargo not found in the active Rust toolchain or PATH.");
  const targetLibrary = run(rustc, ["--print", "target-libdir", "--target", "wasm32-wasip2"], { encoding: "utf8" }).trim();
  if (!targetLibrary || !fs.existsSync(targetLibrary)) {
    throw new Error("Rust target wasm32-wasip2 is not installed for the active toolchain. Run: rustup target add wasm32-wasip2");
  }
  return { toolchain: sysroot, rustc, cargo, targetLibrary };
}

export function discoverWasmtime(options = {}) {
  const executable = findExecutable("wasmtime", options);
  if (!executable) throw new Error("Wasmtime not found. Install Wasmtime and add its bin directory to PATH, or set WASMTIME_HOME.");
  return executable;
}
