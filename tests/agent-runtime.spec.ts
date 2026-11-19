import { describe, expect, it } from "vitest";
import { expandModelAlias, parseCredits, resolveAgentModel } from "../src/main/agent-runtime";

describe("parseCredits", () => {
  it("accepts finite non-negative numbers", () => {
    expect(parseCredits(0)).toBe(0);
    expect(parseCredits(12.5)).toBe(12.5);
  });

  it("accepts numeric strings with an optional x prefix", () => {
    expect(parseCredits("x12")).toBe(12);
    expect(parseCredits(" 8 credits")).toBe(8);
    expect(parseCredits("1.5")).toBe(1.5);
  });

  it("rejects negative, infinite and non-numeric values", () => {
    expect(parseCredits(-1)).toBeNull();
    expect(parseCredits(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseCredits("unlimited")).toBeNull();
    expect(parseCredits(null)).toBeNull();
  });
});

describe("expandModelAlias", () => {
  it("passes unknown model ids through", () => {
    expect(expandModelAlias("gpt-4", [])).toEqual(["gpt-4"]);
  });

  it("maps the hy4 alias to the only hy4 model", () => {
    expect(expandModelAlias("hy4", [])).toEqual(["hy4free"]);
    expect(expandModelAlias("hy4", [{ id: "hy4free", credits: 3 }])).toEqual(["hy4free"]);
  });
});

describe("resolveAgentModel", () => {
  it("uses an explicit model and reports its source", () => {
    const catalog = [
      { id: "deepseek-v4.1-flash", credits: 1 },
      { id: "hy4free", credits: 0 },
    ];

    const result = resolveAgentModel("hy4", catalog, "/nonexistent/config.json");

    expect(result.model).toBe("hy4free");
    expect(result.source).toBe("explicit");
    expect(result.fallbacks).toEqual(["deepseek-v4.1-flash"]);
  });

  it("ignores the auto placeholder", () => {
    const previousNovel = process.env.NOVEL_AGENT_MODEL;
    const previousCodeBuddy = process.env.CODEBUDDY_DEFAULT_MODEL;
    delete process.env.NOVEL_AGENT_MODEL;
    delete process.env.CODEBUDDY_DEFAULT_MODEL;
    try {
      const catalog = [{ id: "deepseek-v4.1-flash", credits: 1 }];

      const result = resolveAgentModel("auto", catalog, "/nonexistent/config.json");

      expect(result.source).toBe("default");
      expect(result.model).toBe("deepseek-v4.1-flash");
    } finally {
      if (previousNovel === undefined) delete process.env.NOVEL_AGENT_MODEL;
      else process.env.NOVEL_AGENT_MODEL = previousNovel;
      if (previousCodeBuddy === undefined) delete process.env.CODEBUDDY_DEFAULT_MODEL;
      else process.env.CODEBUDDY_DEFAULT_MODEL = previousCodeBuddy;
    }
  });
});
