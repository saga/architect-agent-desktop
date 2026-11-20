import { describe, expect, it, vi } from "vitest";
import {
  CODE_MODE_SYSTEM_INSTRUCTIONS,
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
      {
        name: "browser_screenshot",
        description: "Capture the active page.",
        schema: { toJSONSchema: () => ({ type: "object" }) },
        handler,
      },
    ]);

    expect(providers.map(provider => provider.name)).toEqual(["browser", "workspace"]);
    const resolved = providers.map(resolveProvider);
    expect(resolved[0].fns.getCurrentPage).toBeTypeOf("function");
    expect(resolved[1].fns.readFile).toBeTypeOf("function");
    const declarations = generateTypesFromJsonSchema(resolved);
    expect(declarations).toContain("readFile(input: { \"path\": string }): Promise<string>");
    expect(declarations).toContain("getCurrentPage(input?: Record<string, unknown>): Promise<string>");
    expect(declarations).toContain("screenshot(input?: Record<string, unknown>): Promise<string | { text: string; image?: { mimeType: string; data: string } }>");
  });

  it("resolves local JSON Schema references when generating API types", () => {
    const [provider] = createToolProviders([{
      name: "workspace_search",
      description: "Search files.",
      schema: { toJSONSchema: () => ({
        type: "object",
        properties: { options: { $ref: "#/$defs/SearchOptions" } },
        required: ["options"],
        $defs: { SearchOptions: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      }) },
      handler: async () => "ok",
    }]);
    expect(generateTypesFromJsonSchema([resolveProvider(provider)]))
      .toContain('"options": { "query": string }');
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
    expect(description).toContain("Promise<string>");
    expect(description).toContain("Promise.all");
    expect(description).not.toContain("workspace");
  });
});

describe("Code Mode system guidance", () => {
  it("explains when to use direct tools versus Code Mode", () => {
    expect(CODE_MODE_SYSTEM_INSTRUCTIONS).toContain("Use a direct tool call for one simple");
    expect(CODE_MODE_SYSTEM_INSTRUCTIONS).toContain("Use execute_code for workflows");
    expect(CODE_MODE_SYSTEM_INSTRUCTIONS).toContain("Promise.all");
    expect(CODE_MODE_SYSTEM_INSTRUCTIONS).toContain("Do not use direct Node.js APIs");
  });
});

describe("normalizeCode", () => {
  it("removes markdown fences and wraps bare statements", () => {
    expect(normalizeCode("```js\nconst tabs = await browser.listTabs();\nreturn tabs;\n```"))
      .toBe("async () => {\nconst tabs = await browser.listTabs();\nreturn tabs;\n}");
  });

  it("parses a single async arrow expression and removes a trailing semicolon", () => {
    const code = "async () => { return await browser.listTabs(); };";
    expect(normalizeCode(code)).toBe("async () => { return await browser.listTabs(); }");
  });

  it("wraps a function declaration followed by statements as one async body", () => {
    const code = "async function main() { return 1; }\\nreturn await main();";
    expect(normalizeCode(code)).toBe("async () => {\\n" + code + "\\n}");
  });

  it("wraps ordinary function declarations and calls as statements", () => {
    const code = "function main() { return 1; }\\nreturn main();";
    expect(normalizeCode(code)).toBe("async () => {\\n" + code + "\\n}");
  });

  it("keeps a non-function expression as an expression", () => {
    expect(normalizeCode("await browser.listTabs();")).toBe("await browser.listTabs()");
  });

  it("rejects empty source", () => {
    expect(() => normalizeCode(" ```js\n``` ")).toThrow("non-empty JavaScript");
  });
});
