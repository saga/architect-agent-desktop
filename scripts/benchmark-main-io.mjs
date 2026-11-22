import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const require = createRequire(import.meta.url);
const {
  importPlugin,
  listApprovedPluginRuntimeEntries,
  listPlugins,
  setPluginRuntimeApproved,
} = require("../dist/main/plugins/plugin-registry.js");
const { importAgentSkillArchive } = require("../dist/main/agent-extensions.js");

// Keep ZIP construction outside the measured import interval. The archive
// contains realistic DEFLATE data so CRC and decompression CPU cost is visible.
const SKILL_FILE_BYTES = 2 * 1024 * 1024;
const SKILL_FILE_COUNT = 4;

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = localOffset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function makeSkillArchive() {
  const entries = [{
    name: "benchmark-skill/SKILL.md",
    data: Buffer.from([
      "---",
      "name: benchmark-skill",
      "description: Benchmark Skill ZIP parsing, CRC and DEFLATE work.",
      "---",
      "",
      "Use this generated package only for local I/O benchmarking.",
    ].join("\n"), "utf8"),
  }];
  let state = 0x6d2b79f5;
  for (let file = 0; file < SKILL_FILE_COUNT; file += 1) {
    const data = Buffer.allocUnsafe(SKILL_FILE_BYTES);
    for (let index = 0; index < data.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[index] = state & 0xff;
    }
    entries.push({
      name: "benchmark-skill/data/file-" + String(file).padStart(2, "0") + ".bin",
      data,
    });
  }
  return createZipArchive(entries);
}

const root = mkdtempSync(path.join(os.tmpdir(), "architect-main-io-benchmark-"));
const source = path.join(root, "source", "io-benchmark");
const pluginRoot = path.join(root, "installed");
const registry = path.join(root, "plugins.json");
const fileCount = 256;
const fileBytes = 32 * 1024;
let measuredBytes = 0;
let activeBenchmarkTimer;
let activeHistogram;

function writeFixture() {
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

async function main() {
  writeFixture();
  const skillArchive = makeSkillArchive();
  const skillArchivePath = path.join(root, "benchmark-skill.zip");
  const skillRoot = path.join(root, "installed-skills");
  const skillRegistry = path.join(root, "skills.json");
  writeFileSync(skillArchivePath, skillArchive);
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  activeHistogram = histogram;
  let lastTick = performance.now();
  let maxTimerLagMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerLagMs = Math.max(maxTimerLagMs, now - lastTick - 2);
    lastTick = now;
  }, 2);
  activeBenchmarkTimer = timer;
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

  console.log("MAIN_IO_BENCHMARK_PHASE skill-zip-import-start");
  const skillZipStart = performance.now();
  const importedSkill = await importAgentSkillArchive(skillArchivePath, skillRoot, skillRegistry);
  const skillZipImportMs = performance.now() - skillZipStart;
  const totalMs = performance.now() - totalStart;

  await new Promise((resolve) => setTimeout(resolve, 20));
  clearInterval(timer);
  activeBenchmarkTimer = undefined;
  histogram.disable();
  activeHistogram = undefined;

  const result = {
    label: process.argv[2] ?? "unspecified",
    node: process.version,
    platform: process.platform,
    fixture: {
      files: fileCount + 3,
      dataBytes: measuredBytes,
      dataMiB: Number((measuredBytes / 1024 / 1024).toFixed(2)),
      skillZipBytes: skillArchive.length,
      skillZipUncompressedMiB: Number((SKILL_FILE_BYTES * SKILL_FILE_COUNT / 1024 / 1024).toFixed(2)),
      skillZipFiles: SKILL_FILE_COUNT + 1,
    },
    timingsMs: {
      import: Number(importMs.toFixed(2)),
      runtimeApproval: Number(approvalMs.toFixed(2)),
      repeatedInspection: Number(inspectionMs.toFixed(2)),
      skillZipImport: Number(skillZipImportMs.toFixed(2)),
      total: Number(totalMs.toFixed(2)),
    },
    eventLoop: {
      delayP95Ms: Number((histogram.percentile(95) / 1e6).toFixed(2)),
      delayMaxMs: Number((histogram.max / 1e6).toFixed(2)),
      maxTimerLagMs: Number(Math.max(0, maxTimerLagMs).toFixed(2)),
    },
    inspectedRuntimeEntries: inspectedEntries,
    importedSkillId: importedSkill.id,
  };
  console.log("MAIN_IO_BENCHMARK " + JSON.stringify(result));
}

main()
  .catch((error) => {
    if (activeBenchmarkTimer) clearInterval(activeBenchmarkTimer);
    activeHistogram?.disable();
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(root, { recursive: true, force: true });
  });
