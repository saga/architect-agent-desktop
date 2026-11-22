import { describe, expect, it } from "vitest";
import { codeBuddyBuiltinToolSelection } from "../src/main/agent-tool-policy";

describe("CodeBuddy native builtin policy", () => {
  const readonlyTools = ["WebFetch", "WebSearch", "ViewImage"];
  it("does not expose native filesystem tools in assisted mode", () => {
    expect(codeBuddyBuiltinToolSelection("assisted", true, readonlyTools)).toEqual(readonlyTools);
  });
  it("keeps Expert-restricted Tasks on Host-checked tools only", () => {
    expect(codeBuddyBuiltinToolSelection("allow-all", false, readonlyTools)).toEqual([]);
  });
  it("allows unrestricted native tools only when both permission layers allow it", () => {
    expect(codeBuddyBuiltinToolSelection("allow-all", true, readonlyTools)).toBeNull();
  });
  it("denies native tools for none and browser-only modes", () => {
    expect(codeBuddyBuiltinToolSelection("none", true, readonlyTools)).toEqual([]);
    expect(codeBuddyBuiltinToolSelection("browser-only", true, readonlyTools)).toEqual([]);
  });
});
