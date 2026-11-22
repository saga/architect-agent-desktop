import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const execFile = promisify(execFileCallback);
const electronExecutable = require("electron");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(repositoryRoot, "tests", "fixtures", "utility-process-runtime-main.cjs");

assert.equal(typeof electronExecutable, "string", "Electron package must resolve to its executable path.");

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "architect-utility-runtime-"));
const userDataDirectory = path.join(temporaryRoot, "user-data");
await mkdir(userDataDirectory, { recursive: true });

function runElectronStage(stage) {
  return new Promise((resolve, reject) => {
    const childEnvironment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
    delete childEnvironment.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronExecutable, [fixturePath, userDataDirectory, stage], {
      cwd: repositoryRoot,
      env: childEnvironment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 128 * 1024) output = output.slice(-128 * 1024);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Electron UtilityProcess integration stage timed out: " + stage + "\n" + output));
    }, 30_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error("Unable to launch Electron for stage " + stage + ": " + error.message + "\n" + output));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error("Electron UtilityProcess integration stage failed: " + stage + " (code=" + code + ", signal=" + signal + ")\n" + output));
    });
  });
}

try {
  for (const stage of ["cancel", "timeout", "dispose"]) {
    await runElectronStage(stage);
    console.log("Electron UtilityProcess stage passed: " + stage);
  }
  console.log("Real Electron UtilityProcess cancellation, timeout and dispose integration passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
