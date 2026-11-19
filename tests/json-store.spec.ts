import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../src/main/json-store";

const directories: string[] = [];

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "architect-json-store-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("writeJsonAtomic", () => {
  it("writes readable JSON and leaves no temporary file behind", () => {
    const directory = tempDir();
    const file = path.join(directory, "state.json");

    writeJsonAtomic(file, { version: 1, items: ["a", "b"] });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, items: ["a", "b"] });
    expect(readdirSync(directory)).toEqual(["state.json"]);
  });

  it("replaces an existing document in one step", () => {
    const directory = tempDir();
    const file = path.join(directory, "state.json");

    writeJsonAtomic(file, { revision: 1 });
    writeJsonAtomic(file, { revision: 2 });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ revision: 2 });
    expect(readdirSync(directory)).toEqual(["state.json"]);
  });

  it("creates missing parent directories", () => {
    const file = path.join(tempDir(), "nested", "deeper", "state.json");

    writeJsonAtomic(file, { ok: true });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ok: true });
  });

  it("writes private files", () => {
    const file = path.join(tempDir(), "state.json");

    writeJsonAtomic(file, { ok: true });

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("tightens permissions on a file created with a wider mode", () => {
    const directory = tempDir();
    const file = path.join(directory, "state.json");
    writeFileSync(file, "{}", { mode: 0o644 });

    writeJsonAtomic(file, { ok: true });

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
