import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface EntraMcpOAuthConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  defaultScopes: string[];
  serverScopes: Record<string, string[]>;
}
export interface McpOAuthChallenge {
  serverName: string;
  serverUrl: string;
  reason?: string;
  wwwAuthenticateParams?: { scope?: string };
  resourceMetadata?: string;
}
export interface McpOAuthToken { accessToken: string; tokenType: string; expiresIn: number; }
export interface McpOAuthSecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
interface TokenResponse {
  access_token?: unknown; token_type?: unknown; expires_in?: unknown;
  refresh_token?: unknown; error?: unknown; error_description?: unknown;
}
interface CachedToken { refreshToken: string; scopes: string[]; }
interface LoopbackCallback { redirectUri: string; waitForCode(): Promise<string>; close(): Promise<void>; }

const ENTRA_LOGIN_HOSTS = new Set(["login.microsoftonline.com", "login.microsoftonline.us", "login.chinacloudapi.cn"]);
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export function isMcpOAuthEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return ["true", "1", "yes", "on"].includes((environment.MCP_OAUTH_ENABLED ?? "").trim().toLowerCase());
}
export function parseOAuthScopes(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const scopes = value.trim().split(/[\s,]+/).filter(Boolean);
  if (scopes.some(scope => !/^[A-Za-z0-9._~:/+-]+$/.test(scope))) {
    throw new Error("MCP OAuth scope 格式无效，请使用 Entra API Permission 的 Scope 名称。");
  }
  return [...new Set(scopes)];
}
export function readEntraMcpOAuthConfig(environment: NodeJS.ProcessEnv = process.env): EntraMcpOAuthConfig {
  const serverScopes: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!key.startsWith("MCP_OAUTH_SCOPES_") || value === undefined) continue;
    const suffix = key.slice("MCP_OAUTH_SCOPES_".length);
    if (suffix) serverScopes[suffix] = parseOAuthScopes(value);
  }
  return {
    enabled: isMcpOAuthEnabled(environment),
    tenantId: (environment.MCP_OAUTH_TENANT_ID ?? "").trim(),
    clientId: (environment.MCP_OAUTH_CLIENT_ID ?? "").trim(),
    defaultScopes: parseOAuthScopes(environment.MCP_OAUTH_SCOPES),
    serverScopes,
  };
}
function parseResourceMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) throw new Error("MCP Server 未提供 Protected Resource Metadata，无法安全发现 Entra 授权服务器。");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("MCP Protected Resource Metadata 不是有效 JSON。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP Protected Resource Metadata 格式无效。");
  return parsed as Record<string, unknown>;
}
export function resolveEntraOpenIdConfigurationUrl(resourceMetadataJson: string | undefined, tenantId: string): string {
  const metadata = parseResourceMetadata(resourceMetadataJson);
  const servers = metadata.authorization_servers;
  if (!Array.isArray(servers) || servers.length === 0 || servers.some(value => typeof value !== "string")) {
    throw new Error("MCP Protected Resource Metadata 缺少有效的 authorization_servers。");
  }
  const advertised: URL[] = [];
  let hasEntraAuthority = false;
  for (const value of servers as string[]) {
    let url: URL;
    try { url = new URL(value); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !ENTRA_LOGIN_HOSTS.has(url.hostname.toLowerCase())) continue;
    hasEntraAuthority = true;
    const tenant = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (!tenant || [tenantId.toLowerCase(), "common", "organizations", "consumers"].includes(tenant)) advertised.push(url);
  }
  if (advertised.length === 0) {
    if (hasEntraAuthority) throw new Error("MCP 授权服务器 Tenant 与 MCP_OAUTH_TENANT_ID 不一致。");
    throw new Error("当前 MCP OAuth 仅接受 Microsoft Entra ID 的 HTTPS 授权服务器。");
  }
  const authority = advertised[0]!;
  const authorityUrl = new URL("/" + encodeURIComponent(tenantId) + "/v2.0", authority.origin);
  return new URL(".well-known/openid-configuration", authorityUrl.toString() + "/").toString();
}
function validateEntraEndpoints(metadata: Record<string, unknown>, origin: string) {
  const endpoint = (value: unknown, name: string): string => {
    if (typeof value !== "string") throw new Error("Entra OpenID metadata 缺少 " + name + "。");
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Entra OpenID metadata 的 " + name + " 无效。"); }
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
      throw new Error("Entra OpenID metadata 的 " + name + " 不属于已验证的 Microsoft 授权域。");
    }
    return url.toString();
  };
  return {
    authorizationEndpoint: endpoint(metadata.authorization_endpoint, "authorization_endpoint"),
    tokenEndpoint: endpoint(metadata.token_endpoint, "token_endpoint"),
  };
}
function validateMcpUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("MCP Server URL 无效，无法使用 OAuth。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("MCP OAuth 只允许 HTTPS 远程服务；HTTP 仅允许本机 loopback。");
  }
}
async function fetchJson(url: string, label: string, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(label + "请求失败（HTTP " + response.status + "）。");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error(label + "返回的不是有效 JSON。"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(label + "返回的数据格式无效。");
  return payload as Record<string, unknown>;
}
function startLoopbackCallback(expectedState: string): Promise<LoopbackCallback> {
  return new Promise((resolve, reject) => {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    let settled = false;
    const codeResult = new Promise<string>((done, fail) => { resolveCode = done; rejectCode = fail; });
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method !== "GET" || url.pathname !== "/") {
        response.writeHead(404).end("Not found"); return;
      }
      if (url.searchParams.get("state") !== expectedState) {
        response.writeHead(400).end("Invalid OAuth state."); return;
      }
      const oauthError = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (oauthError || !code) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(
          "<!doctype html><meta charset=\"utf-8\"><title>Sign-in failed</title><p>Sign-in was not completed. Return to Architect Agent Desktop.</p>",
        );
        if (!settled) { settled = true; rejectCode(new Error("Entra 登录未完成。" + (oauthError ? " OAuth error: " + oauthError : ""))); }
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(
        "<!doctype html><meta charset=\"utf-8\"><title>Sign-in complete</title><p>Sign-in completed. You can return to Architect Agent Desktop.</p>",
      );
      if (!settled) { settled = true; resolveCode(code); }
    });
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        void new Promise<void>(done => server.close(() => done()));
        reject(new Error("无法建立本机 OAuth 回调监听器。"));
        return;
      }
      const timer = setTimeout(() => {
        if (!settled) { settled = true; rejectCode(new Error("Entra 登录等待超时，请重试。")); }
      }, CALLBACK_TIMEOUT_MS);
      timer.unref();
      resolve({
        redirectUri: "http://localhost:" + address.port,
        waitForCode: () => codeResult,
        close: async () => {
          clearTimeout(timer);
          await new Promise<void>(done => { if (!server.listening) done(); else server.close(() => done()); });
        },
      });
    });
  });
}
function oauthError(payload: TokenResponse, status: number): Error & { oauthCode?: string } {
  const code = typeof payload.error === "string" ? payload.error : "";
  const detail = typeof payload.error_description === "string" ? payload.error_description.slice(0, 500) : "";
  const error = new Error("Entra Token Endpoint 返回错误（HTTP " + status + ")" + (code ? " " + code : "") + (detail ? "：" + detail : "")) as Error & { oauthCode?: string };
  error.oauthCode = code;
  return error;
}

export class EntraMcpOAuthProvider {
  private readonly tokens = new Map<string, CachedToken>();
  private readonly inFlight = new Map<string, Promise<McpOAuthToken>>();
  private loaded = false;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: EntraMcpOAuthConfig,
    private readonly options: {
      storageFile: string;
      secureStorage: McpOAuthSecureStorage;
      openExternal: (url: string) => Promise<void>;
      fetcher?: typeof fetch;
    },
  ) {}

  authenticate(request: McpOAuthChallenge): Promise<McpOAuthToken> {
    if (!request.serverName || !request.serverUrl) return Promise.reject(new Error("MCP OAuth 请求缺少 Server 身份信息。"));
    const existing = this.inFlight.get(request.serverName);
    if (existing) return existing;
    const pending = this.authenticateOnce(request).finally(() => this.inFlight.delete(request.serverName));
    this.inFlight.set(request.serverName, pending);
    return pending;
  }

  private async authenticateOnce(request: McpOAuthChallenge): Promise<McpOAuthToken> {
    if (!this.config.enabled) throw new Error("MCP OAuth 未启用，请在 .env 中设置 MCP_OAUTH_ENABLED=true。");
    if (!this.config.tenantId || !this.config.clientId) throw new Error("请在 .env 中配置 MCP_OAUTH_TENANT_ID 和 MCP_OAUTH_CLIENT_ID。");
    validateMcpUrl(request.serverUrl);
    const suffix = request.serverName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const scopes = parseOAuthScopes(request.wwwAuthenticateParams?.scope);
    const requiredScopes = scopes.length ? scopes : this.config.serverScopes[suffix] ?? this.config.defaultScopes;
    if (requiredScopes.length === 0) throw new Error("MCP Server 未提供 OAuth scope。请设置 MCP_OAUTH_SCOPES 或 MCP_OAUTH_SCOPES_<SERVER_ID>。");
    const effectiveScopes = [...new Set([...requiredScopes, "offline_access"])];
    const metadataUrl = resolveEntraOpenIdConfigurationUrl(request.resourceMetadata, this.config.tenantId);
    const fetcher = this.options.fetcher ?? fetch;
    const oidc = await fetchJson(metadataUrl, "Entra OpenID Configuration", fetcher);
    const endpoints = validateEntraEndpoints(oidc, new URL(metadataUrl).origin);

    await this.loadTokenStore();
    const cached = this.tokens.get(request.serverName);
    if (cached?.refreshToken) {
      try {
        const refreshed = await this.exchangeToken(endpoints.tokenEndpoint, {
          grant_type: "refresh_token", refresh_token: cached.refreshToken,
          client_id: this.config.clientId, scope: effectiveScopes.join(" "),
        }, fetcher);
        const token = this.toMcpToken(refreshed);
        await this.saveToken(request.serverName, {
          refreshToken: typeof refreshed.refresh_token === "string" ? refreshed.refresh_token : cached.refreshToken,
          scopes: effectiveScopes,
        });
        return token;
      } catch (error) {
        const code = (error as { oauthCode?: string } | null)?.oauthCode;
        if (!["invalid_grant", "interaction_required", "consent_required", "invalid_scope"].includes(code ?? "")) throw error;
        this.tokens.delete(request.serverName);
        await this.persistTokenStore();
      }
    }
    const acquired = await this.acquireInteractiveToken(endpoints.authorizationEndpoint, endpoints.tokenEndpoint, effectiveScopes, fetcher);
    const token = this.toMcpToken(acquired);
    if (typeof acquired.refresh_token === "string" && acquired.refresh_token) {
      await this.saveToken(request.serverName, { refreshToken: acquired.refresh_token, scopes: effectiveScopes });
    }
    return token;
  }

  private async acquireInteractiveToken(authorizationEndpoint: string, tokenEndpoint: string, scopes: string[], fetcher: typeof fetch): Promise<TokenResponse> {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const callback = await startLoopbackCallback(state);
    try {
      const url = new URL(authorizationEndpoint);
      url.searchParams.set("client_id", this.config.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", callback.redirectUri);
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", scopes.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      await this.options.openExternal(url.toString());
      const code = await callback.waitForCode();
      return this.exchangeToken(tokenEndpoint, {
        grant_type: "authorization_code", code, redirect_uri: callback.redirectUri,
        client_id: this.config.clientId, code_verifier: verifier, scope: scopes.join(" "),
      }, fetcher);
    } finally { await callback.close(); }
  }

  private async exchangeToken(endpoint: string, fields: Record<string, string>, fetcher: typeof fetch): Promise<TokenResponse> {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(fields).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    let payload: TokenResponse;
    try { payload = await response.json() as TokenResponse; } catch { throw new Error("Entra Token Endpoint 返回了无效响应。"); }
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) throw oauthError(payload, response.status);
    return payload;
  }

  private toMcpToken(payload: TokenResponse): McpOAuthToken {
    const expires = typeof payload.expires_in === "number" ? payload.expires_in :
      typeof payload.expires_in === "string" ? Number(payload.expires_in) : 3600;
    return {
      accessToken: payload.access_token as string,
      tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
      expiresIn: Number.isFinite(expires) && expires > 0 ? Math.floor(expires) : 3600,
    };
  }

  private async loadTokenStore(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.options.secureStorage.isEncryptionAvailable()) return;
    try {
      const raw = JSON.parse(await readFile(this.options.storageFile, "utf8")) as { version?: unknown; entries?: unknown };
      if (raw.version !== 1 || !raw.entries || typeof raw.entries !== "object" || Array.isArray(raw.entries)) return;
      for (const [name, encrypted] of Object.entries(raw.entries)) {
        if (typeof encrypted !== "string") continue;
        try {
          const token = JSON.parse(this.options.secureStorage.decryptString(Buffer.from(encrypted, "base64"))) as CachedToken;
          if (typeof token.refreshToken === "string" && Array.isArray(token.scopes)) {
            this.tokens.set(name, { refreshToken: token.refreshToken, scopes: token.scopes.filter((scope): scope is string => typeof scope === "string") });
          }
        } catch { /* inaccessible credentials require a new sign-in */ }
      }
    } catch { /* first run or unreadable cache requires a new sign-in */ }
  }

  private async saveToken(name: string, token: CachedToken): Promise<void> {
    this.tokens.set(name, token);
    await this.persistTokenStore();
  }

  private async persistTokenStore(): Promise<void> {
    if (!this.options.secureStorage.isEncryptionAvailable()) return;
    this.persistQueue = this.persistQueue.then(async () => {
      const entries: Record<string, string> = {};
      for (const [name, token] of this.tokens) {
        entries[name] = this.options.secureStorage.encryptString(JSON.stringify(token)).toString("base64");
      }
      await mkdir(path.dirname(this.options.storageFile), { recursive: true });
      const temporary = this.options.storageFile + "." + randomBytes(6).toString("hex") + ".tmp";
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, entries }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.options.storageFile);
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    });
    await this.persistQueue;
  }
}
