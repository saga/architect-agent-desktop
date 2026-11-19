import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

type ParentPort = {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("This module must run inside Electron UtilityProcess.");

const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
let currentExecutionId: string | null = null;

function send(message: Record<string, unknown>): void {
  if (!currentExecutionId) return;
  parentPort?.postMessage({ ...message, executionId: currentExecutionId });
}

function callCapability(capability: string, args: unknown): Promise<unknown> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    send({ type: "capability.request", requestId, capability, args });
  });
}

const api = Object.freeze({
  workspace: Object.freeze({
    listFiles: (path = "", recursive = false) => callCapability("workspace.list", { path, recursive }),
    readFile: (path: string) => callCapability("workspace.read", { path }),
    writeFile: (path: string, content: string) => callCapability("workspace.write", { path, content }),
  }),
  log: Object.freeze({
    info: (message: unknown) => send({ type: "log", level: "info", message: String(message) }),
    warn: (message: unknown) => send({ type: "log", level: "warn", message: String(message) }),
    error: (message: unknown) => send({ type: "log", level: "error", message: String(message) }),
  }),
});

parentPort.on("message", (event) => {
  const message = event.data as Record<string, unknown>;
  if (!message || typeof message !== "object") return;

  if (message.type === "capability.response" && typeof message.requestId === "string") {
    const pendingRequest = pending.get(message.requestId);
    if (!pendingRequest) return;
    pending.delete(message.requestId);
    if (message.ok) pendingRequest.resolve(message.value);
    else pendingRequest.reject(new Error(String(message.error ?? "Capability call failed.")));
    return;
  }

  if (message.type !== "execute" || typeof message.executionId !== "string" || typeof message.entry !== "string") return;
  currentExecutionId = message.executionId;
  void (async () => {
    try {
      const module = await import(pathToFileURL(message.entry as string).href);
      const run = typeof module.run === "function" ? module.run : typeof module.default === "function" ? module.default : null;
      if (!run) throw new Error("Skill module must export a run(args, api) function or a default function.");
      const result = await run(message.args, api);
      send({ type: "result", value: result });
    } catch (error) {
      send({ type: "error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
    } finally {
      for (const request of pending.values()) request.reject(new Error("Execution finished."));
      pending.clear();
      currentExecutionId = null;
    }
  })();
});
