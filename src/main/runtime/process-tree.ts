import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export interface ProcessTreeProcess {
  pid: number;
  ppid: number;
  state: string;
}

export interface ProcessTreeAdapter {
  platform: NodeJS.Platform;
  listProcesses(): Promise<ProcessTreeProcess[]>;
  signal(pid: number, signal: NodeJS.Signals): void;
  isAlive(pid: number): Promise<boolean>;
  runTaskkill(pid: number): Promise<void>;
  delay(ms: number): Promise<void>;
}

const PROCESS_EXIT_TIMEOUT_MS = 3_000;
const PROCESS_POLL_INTERVAL_MS = 40;
const MAX_TREE_DISCOVERY_PASSES = 64;

const defaultAdapter: ProcessTreeAdapter = {
  platform: process.platform,
  async listProcesses() {
    const { stdout } = await execFile("ps", ["-A", "-o", "pid=,ppid=,stat="], {
      encoding: "utf8",
      timeout: 2_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(stdout).split(/\r?\n/).flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
      if (!match) return [];
      return [{ pid: Number(match[1]), ppid: Number(match[2]), state: match[3] ?? "" }];
    });
  },
  signal(pid, signal) {
    process.kill(pid, signal);
  },
  async isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  },
  async runTaskkill(pid) {
    await execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024,
    });
  },
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

function isMissingProcess(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ESRCH";
}

function descendantsOf(rootPid: number, processes: readonly ProcessTreeProcess[]): Array<{ pid: number; depth: number }> {
  const children = new Map<number, number[]>();
  for (const item of processes) {
    const list = children.get(item.ppid) ?? [];
    list.push(item.pid);
    children.set(item.ppid, list);
  }
  const result: Array<{ pid: number; depth: number }> = [];
  const visited = new Set<number>([rootPid]);
  const queue: Array<{ pid: number; depth: number }> = [{ pid: rootPid, depth: 0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const parent = queue[index]!;
    for (const childPid of children.get(parent.pid) ?? []) {
      if (visited.has(childPid)) continue;
      visited.add(childPid);
      result.push({ pid: childPid, depth: parent.depth + 1 });
      queue.push({ pid: childPid, depth: parent.depth + 1 });
    }
  }
  return result;
}

async function waitForProcessesToExit(
  pids: readonly number[],
  adapter: ProcessTreeAdapter,
): Promise<void> {
  const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (adapter.platform === "win32") {
      const alive = await Promise.all(pids.map((pid) => adapter.isAlive(pid)));
      if (!alive.some(Boolean)) return;
    } else {
      const rows = await adapter.listProcesses();
      const states = new Map(rows.map((item) => [item.pid, item.state.toUpperCase()]));
      const alive = pids.some((pid) => {
        const state = states.get(pid);
        return state !== undefined && !state.startsWith("Z");
      });
      if (!alive) return;
    }
    await adapter.delay(PROCESS_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for the UtilityProcess process tree to exit.");
}

/**
 * Forcefully stops a UtilityProcess and all descendants that still belong to
 * its OS process tree. This is lifecycle cleanup, not a security sandbox.
 *
 * Windows delegates tree termination to taskkill /T. POSIX first stops the
 * root, repeatedly discovers and stops newly observed descendants, then kills
 * descendants from leaves to root so children cannot outlive their parent.
 */
export async function terminateProcessTree(
  rootPid: number | undefined,
  adapter: ProcessTreeAdapter = defaultAdapter,
): Promise<void> {
  if (!Number.isSafeInteger(rootPid) || !rootPid || rootPid <= 0) return;

  if (adapter.platform === "win32") {
    if (!(await adapter.isAlive(rootPid))) return;
    try {
      await adapter.runTaskkill(rootPid);
    } catch (error) {
      if (await adapter.isAlive(rootPid)) throw error;
    }
    await waitForProcessesToExit([rootPid], adapter);
    return;
  }

  if (!(await adapter.isAlive(rootPid))) return;
  try {
    adapter.signal(rootPid, "SIGSTOP");
  } catch (error) {
    if (isMissingProcess(error)) return;
    throw error;
  }

  const stopped = new Set<number>([rootPid]);
  const discovered = new Map<number, number>();
  let discoveryError: unknown;

  for (let pass = 0; pass < MAX_TREE_DISCOVERY_PASSES; pass += 1) {
    let rows: ProcessTreeProcess[];
    try {
      rows = await adapter.listProcesses();
    } catch (error) {
      discoveryError = error;
      break;
    }
    const descendants = descendantsOf(rootPid, rows);
    const fresh = descendants.filter((item) => !stopped.has(item.pid));
    for (const item of descendants) discovered.set(item.pid, item.depth);
    if (fresh.length === 0) break;
    for (const item of fresh) {
      try {
        adapter.signal(item.pid, "SIGSTOP");
        stopped.add(item.pid);
      } catch (error) {
        if (!isMissingProcess(error)) discoveryError ??= error;
      }
    }
    if (pass === MAX_TREE_DISCOVERY_PASSES - 1) {
      discoveryError ??= new Error("The UtilityProcess process tree did not stabilize during shutdown.");
    }
  }

  const orderedDescendants = [...discovered.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([pid]) => pid);
  for (const pid of orderedDescendants) {
    try {
      adapter.signal(pid, "SIGKILL");
    } catch (error) {
      if (!isMissingProcess(error)) discoveryError ??= error;
    }
  }
  try {
    adapter.signal(rootPid, "SIGKILL");
  } catch (error) {
    if (!isMissingProcess(error)) discoveryError ??= error;
  }

  await waitForProcessesToExit([rootPid, ...orderedDescendants], adapter);
  if (discoveryError) throw discoveryError;
}
