import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;

export interface LocalServerOptions {
  port?: number;
  baseUrl?: string;
  apiKey?: string;
}

function loopbackUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "localhost" && host !== "::1" && isIP(host) !== 4) {
    throw new Error("Local LLM endpoint must use localhost or a loopback IP address.");
  }
  if (isIP(host) === 4 && !host.startsWith("127.")) {
    throw new Error("Local LLM endpoint must use a loopback IP address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local LLM endpoint must use HTTP or HTTPS.");
  }
  return url;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

function isLoopbackHostHeader(value: string | undefined, port: number): boolean {
  if (!value) return false;
  const candidate = value.toLowerCase();
  return candidate === `127.0.0.1:${port}` || candidate === `localhost:${port}`
    || candidate === `[::1]:${port}`;
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (url.protocol === "http:" || url.protocol === "https:")
      && (host === "localhost" || host === "::1" || host.startsWith("127."));
  } catch {
    return false;
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds the 1 MB limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export class LocalApiServer {
  private server: Server | null = null;
  private readonly port: number;
  private readonly upstream: URL;
  private readonly apiKey: string;

  constructor(options: LocalServerOptions = {}) {
    this.port = options.port ?? Number(process.env.ARCHITECT_LOCAL_SERVER_PORT ?? 4317);
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      throw new Error("ARCHITECT_LOCAL_SERVER_PORT must be a valid TCP port.");
    }
    this.upstream = loopbackUrl(options.baseUrl ?? process.env.ARCHITECT_LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:11434/v1");
    this.apiKey = options.apiKey ?? process.env.ARCHITECT_LOCAL_LLM_API_KEY ?? "";
  }

  get address(): string {
    return `http://${HOST}:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isLoopbackHostHeader(request.headers.host, this.port)) {
      sendJson(response, 403, { error: { message: "Invalid Host header." } });
      return;
    }
    const origin = request.headers.origin;
    if (origin && !isLoopbackOrigin(origin)) {
      sendJson(response, 403, { error: { message: "Cross-origin requests are not allowed." } });
      return;
    }

    const pathname = (request.url ?? "/").split("?", 1)[0] ?? "/";
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }
    if (origin) response.setHeader("access-control-allow-origin", origin);
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { status: "ok", bind: HOST, llm: this.upstream.origin });
      return;
    }
    if (request.method === "GET" && pathname === "/v1/models") {
      await this.proxy(request, response, "/models");
      return;
    }
    if (request.method === "POST" && pathname === "/v1/chat/completions") {
      await this.proxy(request, response, "/chat/completions");
      return;
    }
    sendJson(response, 404, { error: { message: "Not found." } });
  }

  private async proxy(request: IncomingMessage, response: ServerResponse, endpoint: string): Promise<void> {
    try {
      const body = request.method === "POST" ? await readBody(request) : undefined;
      if (endpoint === "/chat/completions" && (!body || !body.length)) {
        sendJson(response, 400, { error: { message: "A model and messages array are required." } });
        return;
      }
      if (body && body.length) {
        try {
          const parsed = JSON.parse(body.toString("utf8")) as { model?: unknown; messages?: unknown };
          if (endpoint === "/chat/completions" && (typeof parsed.model !== "string" || !Array.isArray(parsed.messages))) {
            sendJson(response, 400, { error: { message: "A model and messages array are required." } });
            return;
          }
        } catch {
          sendJson(response, 400, { error: { message: "Request body must be valid JSON." } });
          return;
        }
      }
      const target = new URL(this.upstream.toString().replace(/\/$/, "") + endpoint);
      const headers: Record<string, string> = { accept: "application/json" };
      if (body) headers["content-type"] = "application/json";
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      response.writeHead(upstreamResponse.status, {
        "content-type": upstreamResponse.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (!upstreamResponse.body) {
        response.end();
        return;
      }
      for await (const chunk of upstreamResponse.body) {
        if (response.destroyed) break;
        response.write(Buffer.from(chunk));
      }
      response.end();
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 502, { error: { message: error instanceof Error ? error.message : "Local LLM request failed." } });
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  }
}
