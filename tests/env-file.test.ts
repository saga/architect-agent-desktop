import { describe, expect, it } from "vitest";
import { parseEnvironmentFile } from "../src/main/env-file";

describe("environment file parsing", () => {
  it("parses comments, export declarations, quoted values and inline comments", () => {
    expect(parseEnvironmentFile([
      "# comment",
      "MCP_OAUTH_ENABLED=true",
      "export MCP_OAUTH_TENANT_ID = tenant-guid",
      'MCP_OAUTH_CLIENT_ID="client-id"',
      "MCP_OAUTH_SCOPES='api://mcp/read offline_access'",
      "PORT=3000 # local port",
      "INVALID LINE",
    ].join("\n"))).toEqual({
      MCP_OAUTH_ENABLED: "true",
      MCP_OAUTH_TENANT_ID: "tenant-guid",
      MCP_OAUTH_CLIENT_ID: "client-id",
      MCP_OAUTH_SCOPES: "api://mcp/read offline_access",
      PORT: "3000",
    });
  });
});
