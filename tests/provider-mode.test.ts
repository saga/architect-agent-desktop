import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAgentDevMode, loadAgentDevMode } from "../src/main/provider-mode";

const directories: string[] = [];
function tempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "architect-agent-mode-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Agent Dev Mode", () => {
  it("defaults to Copilot-only when .env does not enable Dev Mode", () => {
    const directory = tempDirectory();
    expect(loadAgentDevMode(directory, false, {})).toBe(false);
    expect(isAgentDevMode()).toBe(false);
  });

  it("enables CodeBuddy only when the local .env explicitly opts in", () => {
    const directory = tempDirectory();
    writeFileSync(path.join(directory, ".env"), "ARCHITECT_AGENT_DEV_MODE=true\n");
    expect(loadAgentDevMode(directory, false, {})).toBe(true);
    expect(isAgentDevMode()).toBe(true);
  });

  it("never enables Dev Mode in a packaged application", () => {
    const directory = tempDirectory();
    writeFileSync(path.join(directory, ".env"), "ARCHITECT_AGENT_DEV_MODE=true\n");
    expect(loadAgentDevMode(directory, true, { ARCHITECT_AGENT_DEV_MODE: "true" })).toBe(false);
    expect(isAgentDevMode()).toBe(false);
  });

  it("does not treat arbitrary truthy strings as an opt-in", () => {
    const directory = tempDirectory();
    writeFileSync(path.join(directory, ".env"), "ARCHITECT_AGENT_DEV_MODE=yes\n");
    expect(loadAgentDevMode(directory, false, {})).toBe(false);
  });
});
