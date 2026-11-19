import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceCapabilityHandlers } from "../src/main/runtime/runtime-capabilities";
import type { RuntimeCapabilityContext } from "../src/main/runtime/runtime-types";

const directories: string[] = [];
function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "architect-runtime-workspace-"));
  directories.push(root);
  return root;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("Workspace runtime capabilities", () => {
  it("reads, writes and lists workspace files", async () => {
    const root = workspace();
    writeFileSync(path.join(root, "existing.txt"), "before");
    const handlers = createWorkspaceCapabilityHandlers();
    const context: RuntimeCapabilityContext = {
      workspaceRoot: root,
      capabilities: new Set(["workspace.list", "workspace.read", "workspace.write"]),
    };
    const read = handlers["workspace.read"], write = handlers["workspace.write"], list = handlers["workspace.list"];
    if (!read || !write || !list) throw new Error("Workspace handlers missing.");
    await expect(read(context, { path: "existing.txt" })).resolves.toBe("before");
    await write(context, { path: "created.txt", content: "after" });
    await expect(read(context, { path: "created.txt" })).resolves.toBe("after");
    await expect(list(context, {})).resolves.toEqual(expect.arrayContaining([
      { path: "existing.txt", type: "file" }, { path: "created.txt", type: "file" },
    ]));
  });

  it("rejects symlinked file access without changing the external target", async () => {
    const root = workspace(), outsideDirectory = workspace();
    const outside = path.join(outsideDirectory, "outside.txt");
    writeFileSync(outside, "keep-this-content");
    symlinkSync(outside, path.join(root, "escape.txt"));
    const handlers = createWorkspaceCapabilityHandlers();
    const context: RuntimeCapabilityContext = {
      workspaceRoot: root,
      capabilities: new Set(["workspace.read", "workspace.write"]),
    };
    const read = handlers["workspace.read"], write = handlers["workspace.write"];
    if (!read || !write) throw new Error("Workspace handlers missing.");
    await expect(read(context, { path: "escape.txt" })).rejects.toThrow();
    await expect(write(context, { path: "escape.txt", content: "overwrite" })).rejects.toThrow();
    expect(readFileSync(outside, "utf8")).toBe("keep-this-content");
  });
});
