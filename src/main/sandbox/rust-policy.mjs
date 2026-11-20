export const RUST_SOURCE_LIMIT = 64 * 1024;
export const RUST_INPUT_LIMIT = 64 * 1024;
export const SNAPSHOT_FILE_LIMIT = 5000;
export const SNAPSHOT_BYTE_LIMIT = 100 * 1024 * 1024;
export const WASM_MEMORY_LIMIT = 256 * 1024 * 1024;
export const WASM_STACK_LIMIT = 8 * 1024 * 1024;
export const WASM_FUEL_LIMIT = 100_000_000;
export const WASM_RUN_TIMEOUT_MS = 60_000;
export const RUST_BUILD_TIMEOUT_MS = 180_000;

const excludedNames = new Set([
  ".git", ".ssh", ".aws", ".azure", ".kube", ".docker", ".gnupg",
  "node_modules", "target", "dist", "build", "release", "coverage",
  ".next", ".nuxt", ".cache", ".venv", "venv", "__pycache__",
  ".idea", ".vscode", ".desktop-agent", ".config", ".local", ".rustup", ".cargo",
  ".npm", ".mozilla", ".thunderbird", ".pki", ".password-store", ".vscode-server",
  ".cursor", ".claude", ".codebuddy", ".copilot", "library", "appdata",
  "application support", "keychains", "secrets", ".secrets",
  ".terraform", ".pulumi", "out", "vendor", ".turbo", ".parcel-cache",
]);

const excludedFiles = new Set([
  ".npmrc", ".pypirc", ".netrc", ".yarnrc", ".ds_store", ".envrc",
  ".git-credentials", ".credentials", "credentials", "credentials.json",
  "service-account.json", "terraform.tfstate",
]);

export function validateRustSource(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("Rust source must be a non-empty string.");
  }
  if (Buffer.byteLength(source, "utf8") > RUST_SOURCE_LIMIT) {
    throw new Error("Rust source exceeds the 64 KiB limit.");
  }
  return source;
}

export function validateRustInput(input) {
  const value = input === undefined ? {} : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Rust task input must be a JSON object.");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > RUST_INPUT_LIMIT) {
    throw new Error("Rust task input exceeds the 64 KiB limit.");
  }
  return serialized;
}

export function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) return false;
  if (/[<>:"|?*]/.test(value)) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

export function isExcludedWorkspaceEntry(name, isDirectory) {
  const lowerName = name.toLowerCase();
  if (excludedNames.has(lowerName) || excludedFiles.has(lowerName)) return true;
  if (lowerName === ".env" || lowerName.startsWith(".env.")) return true;
  if (
    lowerName.includes("id_rsa")
    || lowerName.includes("id_ed25519")
    || lowerName.startsWith("ssh_host_")
  ) return true;
  if (!isDirectory && [
    ".pem", ".key", ".p12", ".pfx", ".jks", ".tfstate", ".p8", ".kdbx", ".mobileprovision",
  ].some((suffix) => lowerName.endsWith(suffix))) return true;
  return false;
}

export function buildWasmSandboxOptions(wasmFile, workspacePath) {
  return {
    wasmFile,
    programName: "desktop_agent_task",
    args: [],
    mapDirs: [{ key: workspacePath, value: "/workspace" }],
    envVars: [{ key: "HOME", value: "/workspace" }],
    allowedOutboundHosts: [],
    wasmTimeout: WASM_RUN_TIMEOUT_MS / 1000,
    wasmMaxMemorySize: WASM_MEMORY_LIMIT,
    wasmMaxWasmStack: WASM_STACK_LIMIT,
    wasmFuel: WASM_FUEL_LIMIT,
  };
}

export function compareFileHashes(before, after) {
  const changes = [];
  for (const [name, hash] of after) {
    if (before.get(name) !== hash) changes.push({ path: name, status: before.has(name) ? "modified" : "added" });
  }
  for (const name of before.keys()) {
    if (!after.has(name)) changes.push({ path: name, status: "deleted" });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
