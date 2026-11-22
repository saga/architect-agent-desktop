import { spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { terminateProcessTree } from "../src/main/runtime/process-tree";

const execFile = promisify(execFileCallback);

async function waitForFile(filePath: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return (await readFile(filePath, "utf8")).trim();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Timed out waiting for the grandchild PID file.");
}

async function processIsRunning(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const { stdout } = await execFile("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1_000,
    });
    const state = stdout.trim().toUpperCase();
    return Boolean(state) && !state.startsWith("Z");
  } catch {
    return false;
  }
}

async function waitForProcessTreeExit(pids: readonly number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = await Promise.all(pids.map(processIsRunning));
    if (!running.some(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const remaining: number[] = [];
  for (const pid of pids) if (await processIsRunning(pid)) remaining.push(pid);
  throw new Error("Processes remained alive after tree cleanup: " + remaining.join(", "));
}

describe("UtilityProcess process-tree OS integration", () => {
  it("terminates a real Node process with a child and grandchild on the current OS", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "architect-process-tree-it-"));
    const pidFile = path.join(workspace, "grandchild.pid");
    let root: ReturnType<typeof spawn> | undefined;
    let grandchildPid: number | undefined;

    const grandchildCode = "setInterval(() => {}, 1000);";
    const childCode = [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      'const grandchild = spawn(process.execPath, ["-e", ' + JSON.stringify(grandchildCode) + '], { stdio: "ignore" });',
      'fs.writeFileSync(process.env.PROCESS_TREE_PID_FILE, String(grandchild.pid));',
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const rootCode = [
      'const { spawn } = require("node:child_process");',
      'spawn(process.execPath, ["-e", ' + JSON.stringify(childCode) + '], { stdio: "ignore", env: process.env });',
      "setInterval(() => {}, 1000);",
    ].join("\n");

    try {
      root = spawn(process.execPath, ["-e", rootCode], {
        stdio: "ignore",
        env: { ...process.env, PROCESS_TREE_PID_FILE: pidFile },
        windowsHide: true,
      });
      expect(root.pid).toBeGreaterThan(0);

      grandchildPid = Number(await waitForFile(pidFile, 5_000));
      expect(Number.isSafeInteger(grandchildPid)).toBe(true);
      expect(grandchildPid).toBeGreaterThan(0);
      expect(await processIsRunning(root.pid!)).toBe(true);
      expect(await processIsRunning(grandchildPid)).toBe(true);

      await terminateProcessTree(root.pid);
      await waitForProcessTreeExit([root.pid!, grandchildPid], 5_000);
    } finally {
      if (root?.pid && (await processIsRunning(root.pid))) {
        try { await terminateProcessTree(root.pid); } catch { root.kill("SIGKILL"); }
      }
      if (grandchildPid && (await processIsRunning(grandchildPid))) {
        try { process.kill(grandchildPid, "SIGKILL"); } catch { /* already exited */ }
      }
      await rm(workspace, { recursive: true, force: true });
    }
  }, 20_000);
});
