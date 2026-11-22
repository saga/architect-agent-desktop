# MCP 与 Agent Skills 配置

## 目标与边界

Settings 采用 OpenCode 风格的左侧分类导航，将 Agent、MCP Servers、Agent Skills 和声明式 Plugins 分开管理。MCP 与 Skills 是 Agent 运行时配置，不复用现有插件 manifest，也不要求用户手工编辑 CodeBuddy 或 Copilot 的配置文件。

所有配置保存在 Electron `app.getPath("userData")` 下：

- `mcp-servers.json`：MCP Server 列表，文件权限为当前用户读写。
- `skills/`：导入的 Skill 目录副本。
- `skills.json`：Skill 启用状态。

## MCP Servers

支持两类传输：

- `stdio`：本地命令、参数、环境变量、工作目录和超时。
- `http`：远程 HTTP MCP URL、Headers 和超时。Copilot 另支持由 Entra 公共客户端提供的远程 MCP OAuth；CodeBuddy 当前使用 Headers / Bearer Token 环境变量。

MCP Server ID 使用小写字母、数字、点、下划线和连字符，且不能使用系统保留名称。配置可通过 `${ENV_VAR}` 引用运行环境变量。变量在启动 Provider 前解析；缺少引用变量时失败关闭，不会把未解析占位符交给 MCP 进程。

Copilot 使用 SDK Session 的 `mcpServers` 配置，STDIO 工作目录映射到 `workingDirectory`；CodeBuddy 使用 Agent SDK 的 `mcpServers` 参数。只有 Agent 最终生效权限为 `allow-all` 时才连接外部 MCP。 `browser-only` 和 `assisted` 不启动外部 MCP，因为任意 MCP 工具的副作用无法由应用现有浏览器工具权限分类准确约束。

MCP 配置变更前会检查 Agent 是否空闲，并重置已有 Copilot Session，确保新配置在下一次请求生效。CodeBuddy 每次请求都会从本地配置构建 MCP Server 清单。

### 远程 MCP OAuth（Copilot）

OAuth 是可选能力，默认关闭。主进程启动时读取开发目录 `.env`；打包应用读取 Electron `userData/.env`。设置 `MCP_OAUTH_ENABLED=true` 后，Copilot SDK 的 MCP OAuth challenge 由主进程处理：根据 MCP Protected Resource Metadata 限定 Entra 授权服务器，使用授权码 + PKCE 和系统浏览器登录，再将 Access Token 返回给 SDK。应用不把 ID Token 当 API Token，也不把 Token 暴露给 Renderer。

需要配置：

- `MCP_OAUTH_TENANT_ID`：Entra Directory / Tenant ID。
- `MCP_OAUTH_CLIENT_ID`：为本桌面应用注册的 Public Client Application ID，不是 MCP API 的 Client ID。不要配置 Client Secret。
- `MCP_OAUTH_SCOPES`：MCP Server 未在 `WWW-Authenticate` 中提供 scope 时使用的默认 API scope。也可设置 `MCP_OAUTH_SCOPES_<SERVER_ID>`，例如 `MCP_OAUTH_SCOPES_GITHUB`。

Entra 应用注册需启用 Mobile and desktop applications，并登记 `http://localhost` 回调地址。应用使用 PKCE，只在 loopback 接口监听本机回调。Refresh Token 仅在 Electron `safeStorage` 可用时加密持久化；不可用时只保留在当前应用进程内存中。MCP Server 仍必须在服务端验证 JWT 签名、`iss`、`tid`、`aud`、`azp`、`oid` 和 `scp` / `roles`，并继续实施业务级 Data Entitlement / Policy 检查。 OAuth 授权码、刷新请求均携带 Protected Resource Metadata 声明的 `resource`，并优先采用 401 challenge 中的 scope；未提供时使用 Metadata 的 `scopes_supported`，最后才使用环境变量配置的 scope。

注意：桌面应用是 Public Client，`MCP_OAUTH_CLIENT_ID` 以及 Token 中的 `azp` 只能标识 Entra 应用注册，不能证明请求一定来自未被篡改的本应用二进制。不要把 Public Client ID 当成强客户端证明；后台自治 Agent 或高信任工作负载应改由受控服务端使用 Workload Identity / Certificate 等身份。

该环境变量开关只控制 Copilot 的交互式 Entra OAuth。CodeBuddy 目前继续通过 HTTP Headers 和 `${ENV_VAR}` 引用提供静态 Bearer Token，不宣称支持同等的 OAuth 浏览器授权流程。

## Agent Skills

导入时选择一个包含 `SKILL.md` 的目录。文件需要有 YAML frontmatter：

```yaml
---
name: review-code
description: Review code changes for correctness and maintainability.
---
```

应用会校验 Skill ID 和描述，拒绝符号链接，并限制单文件与整个目录大小。导入后复制到应用管理目录；删除安装副本不会删除原始目录。启用的 Skill 正文会加入新 Agent Session 的系统指令上下文，并保留 frontmatter 作为元数据而不重复注入。

Skill 包中的脚本或命令不会由导入器执行。当前产品不提供 Native Skill Runtime，也没有从 Skill 清单调用本地脚本的入口；Skill 内容属于用户提供的任务指引，不能覆盖应用级安全规则。需要执行脚本时，必须走独立的、明确授权的工具或插件运行时，而不是把 Skill Markdown 当作执行许可。

## 运行时与权限

MCP 和 Skill 状态通过主进程 IPC 管理；每个 handler 都校验可信 renderer frame。修改操作要求 Agent、Schedule 和 Task 切换均处于空闲状态。MCP 服务仅在有效工具权限为 `allow-all` 时注册；有效权限仍受 Expert 权限上限约束。

配置变化不需要重启整个 Electron 应用。Copilot Session 会在下一次请求前重建；CodeBuddy 从更新后的配置创建下一次 query。


## 示例和 Claude Desktop 兼容

仓库内提供以下示例：

- examples/mcp/firecrawl-stdio.json：官方 npm 包 firecrawl-mcp 的本地 STDIO 连接配置。
- examples/mcp/firecrawl-http.json：Firecrawl 托管 Streamable HTTP 端点。
- examples/skills/web-research/SKILL.md：可直接导入的 Web Research 示例 Skill。

设置页的“添加示例 MCP”会添加 Firecrawl 本地或托管配置。默认不写 API Key，Firecrawl keyless 模式可限速使用基础 search / scrape / parse 工具。为使用完整工具集，在 MCP 环境变量或 HTTP Authorization Header 中配置 FIRECRAWL_API_KEY。不要将密钥提交到示例文件。

Agent Skills 支持选择目录，以及上传 Claude Desktop 风格的 ZIP。ZIP 必须包含一个顶层 Skill 目录，目录名与 frontmatter 的 name 相同。兼容标准 SKILL.md 和 Claude 文档示例中的 skill.md。解压器限制压缩包/展开大小、文件数量、压缩算法和路径；拒绝加密 ZIP、ZIP64、符号链接、特殊文件和路径穿越。

Claude Desktop 当前使用 Customize > Skills 上传 Skill ZIP；MCP 本地服务可通过 Desktop Extensions（.mcpb）目录安装，也可通过 claude_desktop_config.json 的 mcpServers 配置。当前应用的 Skill ZIP 入口对齐 Claude 的 ZIP 上传形态；MCP 采用相同的 STDIO / HTTP server 字段模型，并提供 Firecrawl 示例，但不会修改 Claude Desktop 配置文件，也不会安装 Claude 的 .mcpb 包。需要在 Claude Desktop 中安装时，按照其 Settings > Desktop app > Manage > Browse extensions 或 Advanced settings > Extension Developer > Install Extension… 流程操作。

详细示例和外部参考见 examples/mcp/README.md。

## 验证

ZIP 导入与安全边界由 tests/agent-extensions.test.ts 覆盖，包括 Claude Desktop 风格的 ZIP 目录结构、大小写兼容、压缩内容校验和路径穿越拒绝。
