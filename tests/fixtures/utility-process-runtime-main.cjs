const assert = require("node:assert/strict");
const path = require("node:path");
const { app } = require("electron");
const { UtilityProcessAgentRuntime } = require(path.resolve(__dirname, "../../dist/main/runtime/utility-process-runtime.js"));

const userDataDirectory = process.argv[2];
const stage = process.argv[3];
if (!userDataDirectory || !stage) throw new Error("Expected userData directory and integration stage arguments.");

app.disableHardwareAcceleration();
app.setPath("userData", userDataDirectory);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function runPendingExecution(runtime, timeoutMs) {
  const started = deferred();
  const controller = new AbortController();
  const execution = runtime.executeGeneratedCode({
    mode: "generated-code",
    code: "async (runtime) => { await runtime.started({ pid: process.pid }); return await new Promise(() => {}); }",
    providers: ["runtime"],
    capabilities: ["tools.call"],
    limits: { timeoutMs, maxOutputBytes: 64 * 1024, maxLogEntries: 20 },
    signal: controller.signal,
  }, async (name, input) => {
    if (name !== "runtime.started") throw new Error("Unexpected Tool Broker call: " + name);
    const pid = input && typeof input === "object" ? Number(input.pid) : Number.NaN;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("UtilityProcess did not report a valid PID.");
    started.resolve(pid);
    return "started";
  });

  const startupTimer = setTimeout(() => started.reject(new Error("UtilityProcess did not announce startup within 8 seconds.")), 8_000);
  try {
    const pid = await started.promise;
    return { pid, controller, execution };
  } finally {
    clearTimeout(startupTimer);
  }
}

async function run() {
  const runtime = new UtilityProcessAgentRuntime();
  try {
    if (stage === "cancel") {
      const pending = await runPendingExecution(runtime, 15_000);
      pending.controller.abort();
      const result = await pending.execution;
      assert.equal(result.status, "cancelled", "AbortSignal must cancel a real UtilityProcess execution.");
      return;
    }

    if (stage === "timeout") {
      const pending = await runPendingExecution(runtime, 1_500);
      const result = await pending.execution;
      assert.equal(result.status, "timed-out", "Runtime time budget must terminate a real UtilityProcess execution.");
      return;
    }

    if (stage === "dispose") {
      const pending = await runPendingExecution(runtime, 15_000);
      await runtime.dispose();
      const result = await Promise.race([
        pending.execution,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Runtime dispose did not settle the active UtilityProcess.")), 5_000)),
      ]);
      assert.equal(result.status, "failed", "Disposing Runtime must terminate the UtilityProcess and settle the active execution.");
      return;
    }

    throw new Error("Unknown integration stage: " + stage);
  } finally {
    await runtime.dispose();
  }
}

app.whenReady().then(run).then(
  () => app.exit(0),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  },
);
