import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles, writeWorkspaceFile } from "../src/main/workspace-files";

const roots: string[] = [];
function makeWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "architect-workspace-test-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.ts"), "export const greeting = 'hello';\n");
  writeFileSync(path.join(root, "README.md"), "# Demo workspace\n");
  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "ignored.js"), "ignored");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("local workspace file access", () => {
  it("lists project files without dependency/build directories", () => {
    const root = makeWorkspace();
    const files = listWorkspaceFiles(root);
    expect(files).toContain("src/app.ts");
    expect(files).toContain("README.md");
    expect(files).not.toContain("node_modules/ignored.js");
  });

  it("reads, searches and writes files relative to the selected root", () => {
    const root = makeWorkspace();
    expect(readWorkspaceFile(root, "src/app.ts")).toContain("greeting");
    expect(searchWorkspaceFiles(root, "hello")).toContain("src/app.ts:1");
    expect(writeWorkspaceFile(root, "src/app.ts", "export const answer = 42;")).toContain("src/app.ts");
    expect(writeWorkspaceFile(root, "README.md", "# Updated")).toContain("README.md");
    expect(writeWorkspaceFile(root, "new.txt", "created")).toContain("new.txt");
    expect(readWorkspaceFile(root, "new.txt")).toBe("created");
    expect(readFileSync(path.join(root, "README.md"), "utf8")).toBe("# Updated");
    expect(readFileSync(path.join(root, "src", "app.ts"), "utf8")).toContain("answer");
  });

  it("rejects traversal and absolute paths", () => {
    const root = makeWorkspace();
    expect(() => readWorkspaceFile(root, "../outside.txt")).toThrow();
    expect(() => writeWorkspaceFile(root, path.join(root, "outside.txt"), "bad")).toThrow();
  });

  it("does not follow symlinks outside the workspace", () => {
    const root = makeWorkspace();
    const outside = path.join(root, "..", "workspace-outside-" + Date.now() + ".txt");
    writeFileSync(outside, "secret");
    roots.push(outside);
    symlinkSync(outside, path.join(root, "outside-link.txt"));
    const outsideDirectory = path.join(root, "..", "workspace-outside-dir-" + Date.now());
    mkdirSync(outsideDirectory);
    roots.push(outsideDirectory);
    writeFileSync(path.join(outsideDirectory, "leaked.txt"), "do-not-list");
    symlinkSync(outsideDirectory, path.join(root, "outside-dir"));
    expect(listWorkspaceFiles(root)).not.toContain("outside-dir/leaked.txt");
    expect(() => readWorkspaceFile(root, "outside-link.txt")).toThrow();
    expect(() => writeWorkspaceFile(root, "outside-link.txt", "changed")).toThrow();
    symlinkSync(path.join(root, "..", "missing-workspace-target-" + Date.now()), path.join(root, "dangling-link.txt"));
    expect(() => writeWorkspaceFile(root, "dangling-link.txt", "changed")).toThrow();
  });
});
