import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  children: [] as Array<any>,
  withoutPid: false,
  terminateProcessTree: vi.fn(async () => undefined),
}));
vi.mock("electron", () => ({
  utilityProcess: {
    fork: () => {
      const listeners = new Map<string, Array<(value: any) => void>>();
      const child: any = {
        pid: runtimeMocks.withoutPid ? undefined : 1000 + runtimeMocks.children.length,
        messages: [] as unknown[],
        killCalls: 0,
        on(event: string, callback: (value: any) => void) {
          listeners.set(event, [...(listeners.get(event) ?? []), callback]); return child;
        },
        once(event: string, callback: (value: any) => void) {
          const once = (value: any) => {
            listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== once));
            callback(value);
          };
          listeners.set(event, [...(listeners.get(event) ?? []), once]); return child;
        },
        emit(event: string, value: any) { for (const listener of [...(listeners.get(event) ?? [])]) listener(value); },
        removeAllListeners() { listeners.clear(); return child; },
        postMessage(message: unknown) { child.messages.push(message); },
        kill() { child.killCalls += 1; },
      };
      runtimeMocks.children.push(child);
      return child;
    },
  },
}));
vi.mock("../src/main/runtime/process-tree", () => ({
  terminateProcessTree: runtimeMocks.terminateProcessTree,
}));
import { UtilityProcessAgentRuntime } from "../src/main/runtime/utility-process-runtime";

let temporary: string, workerPath: string;
beforeEach(() => {
  runtimeMocks.children.length = 0;
  runtimeMocks.withoutPid = false;
  runtimeMocks.terminateProcessTree.mockClear();
  temporary = mkdtempSync(path.join(tmpdir(), "architect-runtime-test-"));
  workerPath = path.join(temporary, "utility-worker.js");
  writeFileSync(workerPath, "// test worker");
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));

describe("UtilityProcess Code Mode execution isolation", () => {
  it("routes concurrent tool calls through their own execution-scoped Broker handlers", async () => {
    const runtime = new UtilityProcessAgentRuntime(workerPath);
    const handlerA = vi.fn(async () => "result-a"), handlerB = vi.fn(async () => "result-b");
    const request = {
      mode: "generated-code" as const, code: "async () => 'ok'", providers: ["browser"],
      capabilities: ["tools.call" as const],
    };
    const executionA = runtime.executeGeneratedCode(request, handlerA);
    const childA = runtimeMocks.children[0]!, messageA = childA.messages[0] as { executionId: string };
    const executionB = runtime.executeGeneratedCode(request, handlerB);
    const childB = runtimeMocks.children[1]!, messageB = childB.messages[0] as { executionId: string };

    childA.emit("message", { data: { type: "capability.request", executionId: messageA.executionId,
      requestId: "a", capability: "tools.call", args: { name: "browser.listTabs" } } });
    childB.emit("message", { data: { type: "capability.request", executionId: messageB.executionId,
      requestId: "b", capability: "tools.call", args: { name: "browser.listTabs" } } });

    await vi.waitFor(() => {
      expect(handlerA).toHaveBeenCalledWith("browser.listTabs", {});
      expect(handlerB).toHaveBeenCalledWith("browser.listTabs", {});
    });
    await vi.waitFor(() => {
      expect(childA.messages).toContainEqual(expect.objectContaining({ type: "capability.response", requestId: "a", value: "result-a" }));
      expect(childB.messages).toContainEqual(expect.objectContaining({ type: "capability.response", requestId: "b", value: "result-b" }));
    });
    childA.emit("message", { data: { type: "result", executionId: messageA.executionId, value: "done-a" } });
    childB.emit("message", { data: { type: "result", executionId: messageB.executionId, value: "done-b" } });
    await expect(Promise.all([executionA, executionB])).resolves.toEqual([
      expect.objectContaining({ status: "completed", result: "done-a" }),
      expect.objectContaining({ status: "completed", result: "done-b" }),
    ]);
    expect(runtimeMocks.terminateProcessTree).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.terminateProcessTree).toHaveBeenNthCalledWith(1, 1000);
    expect(runtimeMocks.terminateProcessTree).toHaveBeenNthCalledWith(2, 1001);
    expect(childA.killCalls).toBe(1);
    expect(childB.killCalls).toBe(1);
    await runtime.dispose();
  });

  it("terminates the process tree when the execution time budget expires", async () => {
    vi.useFakeTimers();
    try {
      const runtime = new UtilityProcessAgentRuntime(workerPath);
      const execution = runtime.executeGeneratedCode({
        mode: "generated-code",
        code: "async () => 'too late'",
        providers: [],
        capabilities: [],
        limits: { timeoutMs: 25 },
      }, vi.fn(async () => undefined));
      const child = runtimeMocks.children[0]!;

      await vi.advanceTimersByTimeAsync(30);

      await expect(execution).resolves.toEqual(expect.objectContaining({ status: "timed-out" }));
      expect(runtimeMocks.terminateProcessTree).toHaveBeenCalledOnce();
      expect(runtimeMocks.terminateProcessTree).toHaveBeenCalledWith(1000);
      expect(child.killCalls).toBe(1);
      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the Electron process handle when cancellation happens before a PID is available", async () => {
    const runtime = new UtilityProcessAgentRuntime(workerPath);
    runtimeMocks.withoutPid = true;
    const controller = new AbortController();
    const execution = runtime.executeGeneratedCode({
      mode: "generated-code",
      code: "async () => 'never'",
      providers: [],
      capabilities: [],
      signal: controller.signal,
    }, vi.fn(async () => undefined));
    const child = runtimeMocks.children[0]!;
    expect(child.pid).toBeUndefined();

    controller.abort();

    await expect(execution).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(runtimeMocks.terminateProcessTree).toHaveBeenCalledWith(undefined);
    expect(child.killCalls).toBe(1);
    await runtime.dispose();
  });
});
