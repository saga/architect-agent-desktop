import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(repositoryRoot, "tests", "fixtures", "schedule-browser-session-main.cjs");

assert.equal(typeof electronExecutable, "string", "Electron package must resolve to its executable path.");

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "architect-schedule-session-"));
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
      reject(new Error("Electron Session integration stage timed out: " + stage + "\n" + output));
    }, 60_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error("Unable to launch Electron for stage " + stage + ": " + error.message + "\n" + output));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("Electron Session integration stage failed: " + stage + " (code=" + code + ", signal=" + signal + ")\n" + output));
      }
    });
  });
}

try {
  await runElectronStage("seed");
  await runElectronStage("verify-and-reset");
  await runElectronStage("verify-reset-persisted");
  await runElectronStage("download");
  console.log("Electron Schedule Session persistence, isolation, reset and download integration passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
