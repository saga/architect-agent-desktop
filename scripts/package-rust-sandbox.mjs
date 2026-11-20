import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { discoverRustToolchain } from "./rust-toolchain-discovery.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "resources", "rust-sandbox");
const staging = destination + ".staging-" + process.pid;
const required = process.argv.includes("--require");
const platformKey = process.platform + ":" + process.arch;
const supported = new Set(["darwin:arm64", "darwin:x64", "win32:x64"]);
if (!supported.has(platformKey)) {
  throw new Error("Rust/WASM packaging supports macOS arm64/x64 and Windows x64 only; got " + platformKey);
}

const require = createRequire(import.meta.url);
const runtimePackagePath = require.resolve("@wasm-sandbox/runtime/package.json");
const runtimePackage = JSON.parse(await fs.readFile(runtimePackagePath, "utf8"));
const runtimeModule = await import("@wasm-sandbox/runtime");
if (runtimePackage.version !== "1.3.0" || typeof runtimeModule.default?.run !== "function") {
  throw new Error("The pinned @wasm-sandbox/runtime 1.3.0 native run() binding is unavailable.");
}

let discovered;
try {
  discovered = discoverRustToolchain();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (required) throw new Error(message);
  console.warn("[rust-sandbox] " + message);
  process.exit(0);
}

const rustc = discovered.rustc;
const cargo = discovered.cargo;
const toolchain = path.resolve(discovered.toolchain);
const executable = process.platform === "win32" ? ".exe" : "";
for (const candidate of [rustc, cargo, discovered.targetLibrary]) {
  await fs.access(candidate).catch(() => { throw new Error("Required Rust/WASI resource is missing: " + candidate); });
}

const rustcVersion = execFileSync(rustc, ["--version"], { encoding: "utf8" }).trim();
const cargoVersion = execFileSync(cargo, ["--version"], { encoding: "utf8" }).trim();
const rustcVerbose = execFileSync(rustc, ["-vV"], { encoding: "utf8" });
const hostTriple = rustcVerbose.split("\n").find((line) => line.startsWith("host:"))?.slice(5).trim();
const expectedHost = {
  "darwin:arm64": "aarch64-apple-darwin",
  "darwin:x64": "x86_64-apple-darwin",
  "win32:x64": "x86_64-pc-windows-msvc",
}[platformKey];
if (hostTriple !== expectedHost) throw new Error("Rust toolchain host triple mismatch: expected " + expectedHost + ", got " + (hostTriple ?? "unknown"));
const rustMatch = /rustc\s+(\d+)\.(\d+)\.(\d+)/.exec(rustcVersion);
if (!rustMatch || Number(rustMatch[1]) !== 1 || Number(rustMatch[2]) < 85) {
  throw new Error("Rust 1.85 or later is required.");
}
const reportedTarget = execFileSync(rustc, ["--print", "target-libdir", "--target", "wasm32-wasip2"], { encoding: "utf8" }).trim();
if (path.resolve(reportedTarget) !== path.resolve(discovered.targetLibrary)) {
  throw new Error("Rust target-libdir does not resolve to the expected wasm32-wasip2 target directory.");
}

await fs.rm(staging, { recursive: true, force: true });
await fs.mkdir(staging, { recursive: true });
try {
  const toolchainOut = path.join(staging, "rust-toolchain");
  await fs.mkdir(path.join(toolchainOut, "bin"), { recursive: true });
  await fs.copyFile(rustc, path.join(toolchainOut, "bin", "rustc" + executable));
  await fs.copyFile(cargo, path.join(toolchainOut, "bin", "cargo" + executable));
  await fs.cp(path.join(toolchain, "lib"), path.join(toolchainOut, "lib"), { recursive: true, dereference: true });

  await fs.cp(path.join(root, "src/main/sandbox/rust-sdk"), path.join(staging, "sdk"), { recursive: true });
  await fs.cp(path.join(root, "src/main/sandbox/rust-template"), path.join(staging, "template"), { recursive: true });

  const licenses = path.join(staging, "licenses");
  await fs.mkdir(licenses, { recursive: true });
  const rustLicenses = path.join(toolchain, "share", "doc", "rust", "licenses");
  await fs.access(rustLicenses);
  await fs.cp(rustLicenses, path.join(licenses, "rust"), { recursive: true });
  const runtimeLicense = path.join(path.dirname(runtimePackagePath), "LICENSE");
  await fs.copyFile(runtimeLicense, path.join(licenses, "wasm-sandbox-LICENSE.txt"));

  const hashes = {};
  async function hashTree(directory, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await hashTree(absolute, relative);
      else if (entry.isFile()) hashes[relative] = createHash("sha256").update(await fs.readFile(absolute)).digest("hex");
    }
  }
  await hashTree(staging);
  await fs.writeFile(path.join(staging, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    enabled: true,
    platform: process.platform,
    arch: process.arch,
    rustcVersion,
    cargoVersion,
    target: "wasm32-wasip2",
    wasmSandboxRuntime: "@wasm-sandbox/runtime",
    wasmSandboxRuntimeVersion: runtimePackage.version,
    sdkVersion: "0.1.0",
    templateVersion: "0.1.0",
    files: hashes,
  }, null, 2) + "\n", "utf8");

  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(staging, destination);
  console.log("[rust-sandbox] Packaged " + platformKey + " / " + rustcVersion + " / @wasm-sandbox/runtime " + runtimePackage.version);
} catch (error) {
  await fs.rm(staging, { recursive: true, force: true });
  throw error;
}
