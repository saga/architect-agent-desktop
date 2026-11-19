import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { createWorkspaceCapabilityHandlers } from "./runtime-capabilities";
import type {
  CodeModeRequest,
  RuntimeCapability,
  RuntimeCapabilityContext,
  RuntimeCapabilityHandlers,
  RuntimeExecutionResult,
  SkillExecutionRequest,
} from "./runtime-types";

const DEFAULT_LIMITS = {
  timeoutMs: 30_000,
  maxOutputBytes: 256 * 1024,
  maxLogEntries: 500,
};

function safeEntry(skillRootValue: string, entry: string): { root: string; file: string } {
  if (!entry || path.isAbsolute(entry) || entry.includes(String.fromCharCode(92)) || entry.includes(String.fromCharCode(0))) {
  }
  const segments = entry.split("/");
  if (segments.some(part => !part || part === "." || part === "..")) {
    throw new Error("Skill entry path traversal is not allowed.");
  }
  const root = realpathSync(skillRootValue);
  const file = path.resolve(root, ...segments);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Skill entry must be inside its skill package.");
  }
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Skill entry must be a regular file.");
  if (![".js", ".mjs", ".cjs"].includes(path.extname(file).toLowerCase())) {
    throw new Error("Native Skill Runtime currently supports .js, .mjs and .cjs files.");
  }
  return { root, file };
}

/**
 * Native Node.js is deliberately restricted to trusted local Skill code.
 * It is a separate process for crash containment, not a security sandbox.
 */
export class UtilityProcessAgentRuntime {
  private readonly handlers: RuntimeCapabilityHandlers;
  private readonly active = new Map<string, UtilityProcess>();

  constructor(
    private readonly workerPath = path.join(__dirname, "utility-worker.js"),
    handlers: RuntimeCapabilityHandlers = {},
  ) {
    this.handlers = { ...createWorkspaceCapabilityHandlers(), ...handlers };
  }

  async executeGeneratedCode(_request: CodeModeRequest): Promise<never> {
    throw new Error(
      "Code Mode is disabled: generated code requires an OS-isolated Sandbox Runtime. " +
      "UtilityProcess and Node.js VM contexts are not security sandboxes."
    );
  }

  async executeSkill(request: SkillExecutionRequest): Promise<RuntimeExecutionResult> {
    if (request.mode !== "trusted-skill") throw new Error("Unsupported execution mode.");
    const { root, file } = safeEntry(request.skillRoot, request.entry);
    const id = randomUUID();
    const startedAt = Date.now();
    const limits = { ...DEFAULT_LIMITS, ...request.limits };
    const capabilities = new Set<RuntimeCapability>(request.capabilities);
    const context: RuntimeCapabilityContext = { workspaceRoot: request.workspaceRoot, capabilities };
    const logs: RuntimeExecutionResult["logs"] = [];
    let outputBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    let child: UtilityProcess | undefined;

    return new Promise<RuntimeExecutionResult>((resolve) => {
      const finish = (status: RuntimeExecutionResult["status"], result?: unknown, error?: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (abortHandler) request.signal?.removeEventListener("abort", abortHandler);
        if (child) {
          child.removeAllListeners();
          child.kill();
        }
        this.active.delete(id);
        resolve({ id, status, ...(result !== undefined ? { result } : {}), ...(error ? { error } : {}), logs, durationMs: Date.now() - startedAt });
      };

      if (request.signal?.aborted) {
        finish("cancelled", undefined, "Execution cancelled.");
        return;
      }

      try {
        if (!existsSync(this.workerPath)) throw new Error("Runtime worker is missing: " + this.workerPath);
        child = utilityProcess.fork(this.workerPath, [], {
          serviceName: "Agent Skill Runtime",
          cwd: root,
        });
        this.active.set(id, child);
      } catch (error) {
        finish("failed", undefined, error instanceof Error ? error.message : String(error));
        return;
      }

      timer = setTimeout(() => finish("timed-out", undefined, "Execution timed out after " + limits.timeoutMs + " ms."), limits.timeoutMs);
      abortHandler = () => finish("cancelled", undefined, "Execution cancelled.");
      request.signal?.addEventListener("abort", abortHandler, { once: true });

      child.on("message", (event) => {
        const message = event.data as Record<string, unknown>;
        if (!message || message.executionId !== id) return;
        if (message.type === "log") {
          const level = message.level === "warn" || message.level === "error" ? message.level : "info";
          const value = String(message.message ?? "").slice(0, 4_000);
          if (logs.length < limits.maxLogEntries) logs.push({ level, message: value, timestamp: Date.now() });
          return;
        }
        if (message.type === "capability.request" && typeof message.requestId === "string" && typeof message.capability === "string") {
          void (async () => {
            try {
              const capability = message.capability as RuntimeCapability;
              if (!capabilities.has(capability)) throw new Error("Capability not granted: " + capability);
              const handler = this.handlers[capability];
              if (!handler) throw new Error("Capability is not implemented: " + capability);
              const value = await handler(context, message.args);
              const serialized = JSON.stringify(value);
              outputBytes += Buffer.byteLength(serialized ?? "null", "utf8");
              if (outputBytes > limits.maxOutputBytes) throw new Error("Execution output limit exceeded.");
              child?.postMessage({ type: "capability.response", executionId: id, requestId: message.requestId, ok: true, value });
            } catch (error) {
              child?.postMessage({
                type: "capability.response",
                executionId: id,
                requestId: message.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }
        if (message.type === "result") {
          const serialized = JSON.stringify(message.value);
          if (Buffer.byteLength(serialized ?? "null", "utf8") > limits.maxOutputBytes) {
            finish("failed", undefined, "Execution result exceeds the output limit.");
          } else {
            finish("completed", message.value);
          }
        } else if (message.type === "error") finish("failed", undefined, String(message.error ?? "Skill execution failed."));
      });
      child.once("exit", (code) => {
        if (!settled) finish("failed", undefined, "Runtime process exited before returning a result (code " + code + ").");
      });
      child.postMessage({
        type: "execute",
        executionId: id,
        entry: file,
        args: request.args ?? null,
      });
    });
  }

  async dispose(): Promise<void> {
    for (const child of this.active.values()) child.kill();
    this.active.clear();
  }
}
