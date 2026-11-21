import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalEmbeddingService,
  normalizeLocalEmbeddingConfig,
} from "../src/main/memory/local-embedding-service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalEmbeddingService", () => {
  it("accepts only loopback Ollama endpoints", () => {
    expect(normalizeLocalEmbeddingConfig({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
    }).baseUrl).toBe("http://localhost:11434");
    expect(() => normalizeLocalEmbeddingConfig({
      provider: "ollama",
      baseUrl: "https://embedding.example.com",
      model: "nomic-embed-text",
    })).toThrow(/localhost|127\.0\.0\.1|::1/);
    expect(() => normalizeLocalEmbeddingConfig({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/proxy",
      model: "nomic-embed-text",
    })).toThrow(/localhost|127\.0\.0\.1|::1/);
    expect(() => normalizeLocalEmbeddingConfig({
      provider: "ollama",
      baseUrl: "http://user:password@127.0.0.1:11434",
      model: "nomic-embed-text",
    })).toThrow();
  });

  it("normalizes Ollama vectors and sends the text only to the configured loopback URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "nomic-embed-text",
      embeddings: [[3, 4, 0, 0, 0, 0, 0, 0]],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalEmbeddingService();
    const result = await service.embed({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
    }, "portfolio risk and liquidity");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/api/embed");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      model: "nomic-embed-text",
      input: ["portfolio risk and liquidity"],
    });
    expect(request.redirect).toBe("error");
    expect(result.vector[0]).toBeCloseTo(0.6);
    expect(result.vector[1]).toBeCloseTo(0.8);
    expect(Math.sqrt(result.vector.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
  });

  it("rejects malformed, zero and non-finite vectors", async () => {
    const invalid = [0, 0, 0, 0, 0, 0, 0, 0];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "nomic-embed-text",
      embeddings: [invalid],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalEmbeddingService();
    await expect(service.embed({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
    }, "invalid")).rejects.toThrow(/零向量/);
  });

  it("rejects responses whose embedding count does not match the input batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "nomic-embed-text",
      embeddings: [[1, 0, 0, 0, 0, 0, 0, 0]],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalEmbeddingService();
    await expect(service.embedMany({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
    }, ["first", "second"])).rejects.toThrow(/quantity|数量/);
  });
});
