import { describe, expect, it } from "vitest";
import {
  isMcpOAuthEnabled, parseOAuthScopes, readEntraMcpOAuthConfig, resolveEntraOpenIdConfigurationUrl,
} from "../src/main/mcp-oauth";

const tenantId = "11111111-2222-3333-4444-555555555555";
const resourceMetadata = JSON.stringify({
  authorization_servers: ["https://login.microsoftonline.com/" + tenantId + "/v2.0"],
});

describe("MCP Entra OAuth configuration", () => {
  it("is disabled by default and accepts explicit environment opt-in", () => {
    expect(isMcpOAuthEnabled({})).toBe(false);
    expect(isMcpOAuthEnabled({ MCP_OAUTH_ENABLED: "false" })).toBe(false);
    expect(isMcpOAuthEnabled({ MCP_OAUTH_ENABLED: "true" })).toBe(true);
    expect(readEntraMcpOAuthConfig({ MCP_OAUTH_ENABLED: "true", MCP_OAUTH_TENANT_ID: tenantId, MCP_OAUTH_CLIENT_ID: "client-id" })).toMatchObject({
      enabled: true, tenantId, clientId: "client-id",
    });
  });
  it("parses and de-duplicates configured OAuth scopes", () => {
    expect(parseOAuthScopes("api://mcp/read, api://mcp/write offline_access")).toEqual(["api://mcp/read", "api://mcp/write", "offline_access"]);
    expect(() => parseOAuthScopes('api://mcp/read "bad scope"')).toThrow(/scope/);
  });
  it("uses the advertised Entra authority and configured tenant", () => {
    expect(resolveEntraOpenIdConfigurationUrl(resourceMetadata, tenantId)).toBe(
      "https://login.microsoftonline.com/" + tenantId + "/v2.0/.well-known/openid-configuration",
    );
  });
  it("rejects non-Entra or insecure authorization servers", () => {
    expect(() => resolveEntraOpenIdConfigurationUrl(JSON.stringify({ authorization_servers: ["https://auth.example.com"] }), tenantId)).toThrow(/Microsoft Entra/);
    expect(() => resolveEntraOpenIdConfigurationUrl(JSON.stringify({ authorization_servers: ["http://login.microsoftonline.com/" + tenantId + "/v2.0"] }), tenantId)).toThrow(/Microsoft Entra/);
  });
  it("rejects a tenant mismatch", () => {
    expect(() => resolveEntraOpenIdConfigurationUrl(JSON.stringify({
      authorization_servers: ["https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0"],
    }), tenantId)).toThrow(/Tenant/);
  });
});
