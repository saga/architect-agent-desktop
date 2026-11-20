import runtime from "@wasm-sandbox/runtime";
import { buildWasmSandboxOptions } from "./rust-policy.mjs";

const wasmFile = process.argv[2];
const workspacePath = process.argv[3];
if (!wasmFile || !workspacePath) {
  throw new Error("WASM runner requires a component path and a staged workspace path.");
}
if (typeof runtime?.run !== "function") {
  throw new Error("@wasm-sandbox/runtime did not expose its native run() binding.");
}

try {
  const result = runtime.run(buildWasmSandboxOptions(wasmFile, workspacePath));
  if (result && typeof result.then === "function") await result;
} catch (error) {
  process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = 1;
}
