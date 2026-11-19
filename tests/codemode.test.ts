import { describe, expect, it, vi } from "vitest";
import {
  createCodeModeDescription,
  createToolProviders,
  generateTypesFromJsonSchema,
  normalizeCode,
  resolveProvider,
} from "../src/main/runtime/codemode";

describe("Code Mode provider composition", () => {
  it("groups flat desktop tools into typed namespaces", () => {
    const handler = vi.fn(async () => "ok");
    const providers = createToolProviders([
      {
        name: "browser_get_current_page",
        description: "Read the active page.",
        schema: { toJSONSchema: () => ({ type: "object", properties: {}, required: [] }) },
        handler,
      },
      {
        name: "workspace_read_file",
        description: "Read a workspace file.",
        schema: { toJSONSchema: () => ({
          type: "object",
          properties: { path: { type: "string", description: "Workspace-relative path." } },
          required: ["path"],
        }) },
        handler,
      },
    ]);

    expect(providers.map(provider => provider.name)).toEqual(["browser", "workspace"]);
    const resolved = providers.map(resolveProvider);
    expect(resolved[0].fns.getCurrentPage).toBeTypeOf("function");
    expect(resolved[1].fns.readFile).toBeTypeOf("function");
    expect(generateTypesFromJsonSchema(resolved)).toContain("readFile(input: { \"path\": string })");
    expect(generateTypesFromJsonSchema(resolved)).toContain("getCurrentPage(input?: Record<string, unknown>)");
  });

  it("executes a resolved provider method through its descriptor", async () => {
    const execute = vi.fn(async (input: unknown) => ({ input }));
    const [provider] = createToolProviders([{
      name: "browser_list_tabs",
      description: "List tabs.",
      schema: { toJSONSchema: () => ({ type: "object" }) },
      handler: execute,
    }]);
    await expect(resolveProvider(provider).fns.listTabs()).resolves.toEqual({ input: {} });
    expect(execute).toHaveBeenCalledWith({});
  });

  it("builds the execute tool description from only the supplied providers", () => {
    const [provider] = createToolProviders([{
      name: "browser_list_tabs",
      description: "List browser tabs.",
      schema: { toJSONSchema: () => ({ type: "object" }) },
      handler: async () => [],
    }]);
    const description = createCodeModeDescription([resolveProvider(provider)]);
    expect(description).toContain("declare const browser");
    expect(description).toContain("listTabs");
    expect(description).not.toContain("workspace");
  });
});

describe("normalizeCode", () => {
  it("removes markdown fences and wraps bare statements", () => {
    expect(normalizeCode("```js\nconst tabs = await browser.listTabs();\nreturn tabs;\n```"))
      .toBe("async () => {\nconst tabs = await browser.listTabs();\nreturn tabs;\n}");
  });

  it("preserves an async arrow function", () => {
    const code = "async () => { return await browser.listTabs(); }";
    expect(normalizeCode(code)).toBe(code);
  });

  it("rejects empty source", () => {
    expect(() => normalizeCode(" ```js\n``` ")).toThrow("non-empty JavaScript");
  });
});
