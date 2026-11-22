import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  importPlugin,
  listApprovedPluginRuntimeEntries,
  listPlugins,
  setPluginRuntimeApproved,
} = require("../dist/main/plugins/plugin-registry.js");

const root = mkdtempSync(path.join(os.tmpdir(), "architect-main-io-benchmark-"));
const source = path.join(root, "source", "io-benchmark");
const pluginRoot = path.join(root, "installed");
const registry = path.join(root, "plugins.json");
const fileCount = 256;
const fileBytes = 32 * 1024;
let measuredBytes = 0;

function writeFixture(): void {
  mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
  mkdirSync(path.join(source, "skills", "research"), { recursive: true });
  mkdirSync(path.join(source, "bin"), { recursive: true });
  mkdirSync(path.join(source, "data"), { recursive: true });
  writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "io-benchmark",
    version: "1.0.0",
    skills: ["./skills"],
  }));
  writeFileSync(path.join(source, "skills", "research", "SKILL.md"), [
    "---",
    "name: research",
    "description: Benchmark plugin file import and inspection.",
    "---",
    "",
    "Use this fixture only for file I/O benchmarking.",
  ].join("\n"));
  writeFileSync(path.join(source, "bin", "check.sh"), "echo benchmark\n");
  const payload = Buffer.alloc(fileBytes, 0x61);
  for (let index = 0; index < fileCount; index += 1) {
    const file = path.join(source, "data", "file-" + String(index).padStart(4, "0") + ".txt");
    writeFileSync(file, payload);
    measuredBytes += payload.byteLength;
  }
}

async function main(): Promise<void> {
  writeFixture();
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  let lastTick = performance.now();
  let maxTimerLagMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerLagMs = Math.max(maxTimerLagMs, now - lastTick - 2);
    lastTick = now;
  }, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));

  histogram.enable();
  const totalStart = performance.now();
  const importStart = performance.now();
  await importPlugin(source, pluginRoot, registry);
  const importMs = performance.now() - importStart;

  const approvalStart = performance.now();
  await setPluginRuntimeApproved("io-benchmark", true, pluginRoot, registry);
  const approvalMs = performance.now() - approvalStart;

  const inspectionStart = performance.now();
  let inspectedEntries = 0;
  for (let index = 0; index < 4; index += 1) {
    inspectedEntries += (await listApprovedPluginRuntimeEntries(pluginRoot, registry)).length;
    await listPlugins(pluginRoot, registry);
  }
  const inspectionMs = performance.now() - inspectionStart;
  const totalMs = performance.now() - totalStart;

  await new Promise((resolve) => setTimeout(resolve, 20));
  clearInterval(timer);
  histogram.disable();

  const result = {
    label: process.argv[2] ?? "unspecified",
    node: process.version,
    platform: process.platform,
    fixture: {
      files: fileCount + 3,
      dataBytes: measuredBytes,
      dataMiB: Number((measuredBytes / 1024 / 1024).toFixed(2)),
    },
    timingsMs: {
      import: Number(importMs.toFixed(2)),
      runtimeApproval: Number(approvalMs.toFixed(2)),
      repeatedInspection: Number(inspectionMs.toFixed(2)),
      total: Number(totalMs.toFixed(2)),
    },
    eventLoop: {
      delayP95Ms: Number((histogram.percentile(95) / 1e6).toFixed(2)),
      delayMaxMs: Number((histogram.max / 1e6).toFixed(2)),
      maxTimerLagMs: Number(Math.max(0, maxTimerLagMs).toFixed(2)),
    },
    inspectedRuntimeEntries: inspectedEntries,
  };
  console.log("MAIN_IO_BENCHMARK " + JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(root, { recursive: true, force: true });
  });
