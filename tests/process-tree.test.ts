import { describe, expect, it, vi } from "vitest";
import {
  terminateProcessTree,
  type ProcessTreeAdapter,
  type ProcessTreeProcess,
} from "../src/main/runtime/process-tree";

function createAdapter(platform: NodeJS.Platform, initial: ProcessTreeProcess[]) {
  const processes = initial.map((item) => ({ ...item }));
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const taskkill = vi.fn(async (rootPid: number) => {
    const removed = new Set<number>([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of processes) {
        if (removed.has(item.ppid) && !removed.has(item.pid)) {
          removed.add(item.pid);
          changed = true;
        }
      }
    }
    for (let index = processes.length - 1; index >= 0; index -= 1) {
      if (removed.has(processes[index]!.pid)) processes.splice(index, 1);
    }
  });
  const adapter: ProcessTreeAdapter = {
    platform,
    listProcesses: async () => processes.map((item) => ({ ...item })),
    signal(pid, signal) {
      signals.push({ pid, signal });
      if (signal === "SIGKILL") {
        const index = processes.findIndex((item) => item.pid === pid);
        if (index >= 0) processes.splice(index, 1);
      }
    },
    isAlive: async (pid) => processes.some((item) => item.pid === pid),
    runTaskkill: taskkill,
    delay: async () => undefined,
  };
  return { adapter, processes, signals, taskkill };
}

describe("UtilityProcess descendant cleanup", () => {
  it("stops the POSIX root before discovering descendants, then kills leaves before parents", async () => {
    const { adapter, processes, signals } = createAdapter("linux", [
      { pid: 100, ppid: 1, state: "Sl" },
      { pid: 101, ppid: 100, state: "Sl" },
      { pid: 103, ppid: 100, state: "Sl" },
      { pid: 102, ppid: 101, state: "Sl" },
    ]);

    await terminateProcessTree(100, adapter);

    expect(signals).toEqual([
      { pid: 100, signal: "SIGSTOP" },
      { pid: 101, signal: "SIGSTOP" },
      { pid: 103, signal: "SIGSTOP" },
      { pid: 102, signal: "SIGSTOP" },
      { pid: 102, signal: "SIGKILL" },
      { pid: 101, signal: "SIGKILL" },
      { pid: 103, signal: "SIGKILL" },
      { pid: 100, signal: "SIGKILL" },
    ]);
    expect(processes).toEqual([]);
  });

  it("rediscovers descendants that appear while the first process-table snapshot is being handled", async () => {
    const processes: ProcessTreeProcess[] = [
      { pid: 300, ppid: 1, state: "Sl" },
      { pid: 301, ppid: 300, state: "Sl" },
    ];
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let added = false;
    const adapter: ProcessTreeAdapter = {
      platform: "linux",
      listProcesses: async () => processes.map((item) => ({ ...item })),
      signal(pid, signal) {
        signals.push({ pid, signal });
        if (pid === 301 && signal === "SIGSTOP" && !added) {
          processes.push({ pid: 302, ppid: 301, state: "Sl" });
          added = true;
        }
        if (signal === "SIGKILL") {
          const index = processes.findIndex((item) => item.pid === pid);
          if (index >= 0) processes.splice(index, 1);
        }
      },
      isAlive: async (pid) => processes.some((item) => item.pid === pid),
      runTaskkill: async () => undefined,
      delay: async () => undefined,
    };

    await terminateProcessTree(300, adapter);

    expect(signals).toEqual([
      { pid: 300, signal: "SIGSTOP" },
      { pid: 301, signal: "SIGSTOP" },
      { pid: 302, signal: "SIGSTOP" },
      { pid: 302, signal: "SIGKILL" },
      { pid: 301, signal: "SIGKILL" },
      { pid: 300, signal: "SIGKILL" },
    ]);
    expect(processes).toEqual([]);
  });

  it("uses taskkill /T semantics on Windows and waits for the root to disappear", async () => {
    const { adapter, processes, taskkill } = createAdapter("win32", [
      { pid: 200, ppid: 1, state: "Running" },
      { pid: 201, ppid: 200, state: "Running" },
      { pid: 202, ppid: 201, state: "Running" },
    ]);

    await terminateProcessTree(200, adapter);

    expect(taskkill).toHaveBeenCalledOnce();
    expect(taskkill).toHaveBeenCalledWith(200);
    expect(processes).toEqual([]);
  });

  it("does nothing for missing or invalid process identifiers", async () => {
    const { adapter, signals, taskkill } = createAdapter("linux", []);
    await terminateProcessTree(undefined, adapter);
    await terminateProcessTree(0, adapter);
    await terminateProcessTree(300, adapter);
    expect(signals).toEqual([]);
    expect(taskkill).not.toHaveBeenCalled();
  });
});
