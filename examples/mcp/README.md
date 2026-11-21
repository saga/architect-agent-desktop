# MCP 与 Agent Skills 示例

## Firecrawl MCP

官方项目：https://github.com/firecrawl/firecrawl-mcp-server

npm 包：https://www.npmjs.com/package/firecrawl-mcp

### 本地 STDIO（推荐用于完整功能）

示例文件：examples/mcp/firecrawl-stdio.json

- Command：npx
- Args：-y firecrawl-mcp
- 默认不写入 API Key。Firecrawl 当前支持 keyless 模式，可限流使用 firecrawl_search、firecrawl_scrape、firecrawl_parse。
- 设置 FIRECRAWL_API_KEY 后可使用需要认证的更多工具。不要把真实 API Key 提交到仓库或写进示例文件。

### Hosted Streamable HTTP

示例文件：examples/mcp/firecrawl-http.json

- URL：https://mcp.firecrawl.dev/v2/mcp
- keyless 同样只有有限速的基础工具；认证后有完整功能。
- API Key 通过 Authorization: Bearer ... 请求头提供。不要把 Key 放进 URL。
- Firecrawl OAuth 登录端点是 https://mcp.firecrawl.dev/v2/mcp-oauth。当前应用的通用 HTTP MCP 配置支持 URL 和 Headers，但尚未实现 MCP OAuth 浏览器授权流程，因此示例使用普通 HTTP endpoint。

## Claude Desktop 对照

### MCP 安装

Claude Desktop 现行优先方式是 Desktop Extensions：

1. 打开 Settings → Desktop app → Manage（旧版布局为 Settings → Extensions）。
2. 在目录中选择 Browse extensions，然后点击 Install。
3. 对自定义扩展，进入 Advanced settings → Extension Developer → Install Extension…，选择 .mcpb 文件。
4. 扩展的 manifest.json 可声明服务启动方式、用户配置项和敏感字段；Claude Desktop 会将标记为 sensitive 的值存入系统安全存储。

旧式/手动方式是在 claude_desktop_config.json 中配置 mcpServers。本项目采用相同的 MCP Server 核心字段（STDIO 的 command / args / env / cwd，以及 HTTP 的 url / headers），但配置存放在本应用的 userData 中，不会修改 Claude Desktop 的配置文件，也不会安装或卸载 Claude 的 .mcpb 扩展。

Firecrawl 的 Claude Desktop 手动配置示例：

    {
      "mcpServers": {
        "firecrawl": {
          "command": "npx",
          "args": ["-y", "firecrawl-mcp"],
          "env": {
            "FIRECRAWL_API_KEY": "YOUR_API_KEY"
          }
        }
      }
    }

### Agent Skills 安装

Claude 的自定义 Skill 安装流程是 Customize → Skills → + → Create skill → Upload a skill，上传 ZIP 文件。ZIP 中必须包含一个以 Skill 名称命名的顶层目录，例如：

    web-research.zip
    └── web-research/
        ├── SKILL.md
        └── references/
            └── sources.md

Claude 的帮助文档示例使用 skill.md；Agent Skills 开放规范使用 SKILL.md。本项目兼容这两种文件名，并同时支持直接选择目录（OpenCode 风格）和上传 ZIP（Claude 风格）。ZIP 上传要求一个顶层 Skill 文件夹，且文件夹名与 frontmatter 中的 name 一致。

### Sample Skill

本仓库提供 examples/skills/web-research/。在 Agent Skills 设置页点击“安装示例”即可导入；也可选择该目录，或将目录打包成 ZIP 后使用“上传 Skill ZIP”安装。

## References

- Claude Desktop local MCP servers and Desktop Extensions: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- Claude custom Skills upload: https://support.claude.com/en/articles/12512198-how-to-create-custom-skills
- Use Skills in Claude: https://support.claude.com/en/articles/12512180-use-skills-in-claude
- Anthropic Desktop Extensions / MCPB: https://www.anthropic.com/research/desktop-extensions
- Firecrawl MCP Server README: https://github.com/firecrawl/firecrawl-mcp-server
