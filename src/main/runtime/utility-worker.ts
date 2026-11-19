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
  if (currentExecutionId) parentPort?.postMessage({ ...message, executionId: currentExecutionId });
}

function callCapability(capability: string, args: unknown): Promise<unknown> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    send({ type: "capability.request", requestId, capability, args });
  });
}

const api = Object.freeze({
  tools: Object.freeze({
    call: (name: string, input: unknown = {}) => callCapability("tools.call", { name, input }),
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
    const item = pending.get(message.requestId);
    if (!item) return;
    pending.delete(message.requestId);
    if (message.ok) item.resolve(message.value);
    else item.reject(new Error(String(message.error ?? "Capability call failed.")));
    return;
  }
  if (message.type === "execute") {
    if (typeof message.executionId !== "string" || typeof message.entry !== "string") return;
    currentExecutionId = message.executionId;
    void (async () => {
      try {
        const module = await import(pathToFileURL(message.entry as string).href);
        const run = typeof module.run === "function" ? module.run : typeof module.default === "function" ? module.default : null;
        if (!run) throw new Error("Skill module must export a run(args, api) function or a default function.");
        send({ type: "result", value: await run(message.args, api) });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
      } finally {
        for (const item of pending.values()) item.reject(new Error("Execution finished."));
        pending.clear();
        currentExecutionId = null;
      }
    })();
    return;
  }
  if (message.type === "execute-code" && typeof message.executionId === "string" && typeof message.code === "string") {
    currentExecutionId = message.executionId;
    void (async () => {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
        const execute = new AsyncFunction("tools", "log", message.code as string);
        const value = await execute(api.tools, api.log);
        send({ type: "result", value });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
      } finally {
        for (const item of pending.values()) item.reject(new Error("Execution finished."));
        pending.clear();
        currentExecutionId = null;
      }
    })();
  }
});
