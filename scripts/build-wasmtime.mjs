import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await fs.readFile(path.join(root, "rust-runtime", "wasmtime-source.json"), "utf8"));
const outputArgument = process.argv.indexOf("--output");
if (outputArgument >= 0 && !process.argv[outputArgument + 1]) throw new Error("--output requires a directory.");
const outputRoot = path.resolve(outputArgument >= 0 ? process.argv[outputArgument + 1] : path.join(root, ".cache", "wasmtime"));
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "architect-wasmtime-build-"));
const sourceDirectory = path.join(temporaryRoot, "source");
const binaryName = process.platform === "win32" ? "wasmtime.exe" : "wasmtime";

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

try {
  console.log("[wasmtime-build] Cloning " + config.repository + " at " + config.tag);
  run("git", ["clone", "--depth", "1", "--branch", config.tag, config.repository, sourceDirectory]);

  const sourceManifest = await fs.readFile(path.join(sourceDirectory, "Cargo.toml"), "utf8");
  const versionMatch = /\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/.exec(sourceManifest);
  if (versionMatch?.[1] !== config.version) {
    throw new Error("Wasmtime source version mismatch: expected " + config.version + ", got " + (versionMatch?.[1] ?? "unknown"));
  }

  const frontendDependency = /cranelift-frontend\s*=\s*\{\s*path\s*=\s*"cranelift\/frontend",\s*version\s*=\s*"([^"]+)"/.exec(sourceManifest);
  if (frontendDependency?.[1] !== config.craneliftFrontendVersion) {
    throw new Error("Wasmtime workspace Cranelift frontend dependency mismatch: expected " + config.craneliftFrontendVersion + ", got " + (frontendDependency?.[1] ?? "unknown"));
  }

  const lockfile = await fs.readFile(path.join(sourceDirectory, "Cargo.lock"), "utf8");
  const frontendVersions = [...lockfile.matchAll(/\[\[package\]\]\s*\nname = "cranelift-frontend"\s*\nversion = "([^"]+)"/g)].map(match => match[1]);
  if (frontendVersions.length !== 1 || frontendVersions[0] !== config.craneliftFrontendVersion) {
    throw new Error("Wasmtime Cargo.lock Cranelift frontend mismatch: expected " + config.craneliftFrontendVersion + ", got " + (frontendVersions.join(", ") || "not found"));
  }

  console.log("[wasmtime-build] Building Wasmtime CLI with the upstream Cargo.lock (Cranelift frontend " + frontendVersions[0] + ").");
  run("cargo", ["build", "--locked", "--release", "--bin", "wasmtime"], { cwd: sourceDirectory });

  const builtBinary = path.join(sourceDirectory, "target", "release", binaryName);
  await fs.access(builtBinary);
  const versionOutput = execFileSync(builtBinary, ["--version"], { encoding: "utf8" }).trim();
  if (!versionOutput.toLowerCase().includes(config.version)) {
    throw new Error("Built Wasmtime version mismatch: " + versionOutput);
  }

  const binDirectory = path.join(outputRoot, "bin");
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(binDirectory, { recursive: true });
  const outputBinary = path.join(binDirectory, binaryName);
  await fs.copyFile(builtBinary, outputBinary);
  if (process.platform !== "win32") await fs.chmod(outputBinary, 0o755);

  let foundLicense = false;
  for (const name of ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT"]) {
    try {
      await fs.copyFile(path.join(sourceDirectory, name), path.join(binDirectory, name));
      foundLicense = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!foundLicense) throw new Error("Wasmtime source license file was not found.");

  const binaryHash = createHash("sha256").update(await fs.readFile(outputBinary)).digest("hex");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceDirectory, encoding: "utf8" }).trim();
  const manifest = {
    schemaVersion: 1,
    sourceRepository: config.repository,
    sourceTag: config.tag,
    sourceCommit,
    wasmtimeVersion: config.version,
    craneliftFrontendVersion: frontendVersions[0],
    binary: "bin/" + binaryName,
    binarySha256: binaryHash,
  };
  await fs.writeFile(path.join(outputRoot, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("[wasmtime-build] Built " + versionOutput + " at " + outputBinary);
  console.log("[wasmtime-build] Build manifest: " + path.join(outputRoot, "build-manifest.json"));
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
