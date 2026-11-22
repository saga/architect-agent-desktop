import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pluginContentFingerprint, stagePluginRuntimeDirectories } from "../src/main/plugins/plugin-content";

const roots: string[] = [];
function temp(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "plugin-runtime-snapshot-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("approved plugin content snapshots", () => {
  it("stages an exact fingerprint-matching copy for provider execution", () => {
    const root = temp();
    const source = path.join(root, "installed", "my-plugin");
    mkdirSync(path.join(source, "bin"), { recursive: true });
    writeFileSync(path.join(source, "plugin.json"), JSON.stringify({ name: "my-plugin" }));
    writeFileSync(path.join(source, "bin", "check.sh"), "echo approved");
    const fingerprint = pluginContentFingerprint(source);

    const [staged] = stagePluginRuntimeDirectories([{
      id: "my-plugin", directory: source, skills: [], fingerprint,
    }], path.join(root, "session-plugins"));

    expect(staged?.directory).toBe(path.join(root, "session-plugins", "my-plugin"));
    expect(readFileSync(path.join(staged!.directory, "bin", "check.sh"), "utf8")).toBe("echo approved");
    expect(pluginContentFingerprint(staged!.directory)).toBe(fingerprint);
  });


  it("rejects oversized files before reading them into the fingerprint", () => {
    const root = temp();
    const source = path.join(root, "oversized-plugin");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "payload.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(() => pluginContentFingerprint(source)).toThrow(/超过 2 MB/);
  });

  it("blocks execution when plugin files change after the user approved them", () => {
    const root = temp();
    const source = path.join(root, "installed", "mutable-plugin");
    mkdirSync(path.join(source, "scripts"), { recursive: true });
    writeFileSync(path.join(source, "scripts", "run.js"), "console.log('approved');");
    const approvedFingerprint = pluginContentFingerprint(source);
    writeFileSync(path.join(source, "scripts", "run.js"), "console.log('modified');");

    const runtimeRoot = path.join(root, "session-plugins");
    expect(() => stagePluginRuntimeDirectories([{
      id: "mutable-plugin", directory: source, skills: [], fingerprint: approvedFingerprint,
    }], runtimeRoot)).toThrow(/发生变化/);
    expect(existsSync(runtimeRoot)).toBe(false);
  });
});
