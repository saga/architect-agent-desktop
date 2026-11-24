import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LocalApiServer } from "../src/main/local-api-server";

describe("LocalApiServer", () => {
  let server: LocalApiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("rejects non-loopback LLM endpoints", () => {
    expect(() => new LocalApiServer({ port: 4318, baseUrl: "http://192.168.1.10:11434/v1" })).toThrow(/loopback/);
  });

  it("rejects invalid ports", () => {
    expect(() => new LocalApiServer({ port: 70000 })).toThrow(/TCP port/);
  });

  it("binds only to loopback and serves health", async () => {
    server = new LocalApiServer({ port: 4318, baseUrl: "http://127.0.0.1:11434/v1" });
    await server.start();
    const response = await fetch("http://127.0.0.1:4318/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", bind: "127.0.0.1" });
  });

  it("rejects an invalid Host header", async () => {
    server = new LocalApiServer({ port: 4318 });
    await server.start();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        hostname: "127.0.0.1",
        port: 4318,
        path: "/health",
        headers: { host: "evil.example" },
      }, response => {
        resolve(response.statusCode ?? 0);
        response.resume();
      });
      request.once("error", reject);
      request.end();
    });
    expect(status).toBe(403);
  });
});
