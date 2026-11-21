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
- `http`：远程 HTTP MCP URL、Headers 和超时。

MCP Server ID 使用小写字母、数字、点、下划线和连字符，且不能使用系统保留名称。配置可通过 `${ENV_VAR}` 引用运行环境变量。变量在启动 Provider 前解析；缺少引用变量时失败关闭，不会把未解析占位符交给 MCP 进程。

Copilot 使用 SDK Session 的 `mcpServers` 配置，STDIO 工作目录映射到 `workingDirectory`；CodeBuddy 使用 Agent SDK 的 `mcpServers` 参数。只有 Agent 最终生效权限为 `allow-all` 时才连接外部 MCP。 `browser-only` 和 `assisted` 不启动外部 MCP，因为任意 MCP 工具的副作用无法由应用现有浏览器工具权限分类准确约束。

MCP 配置变更前会检查 Agent 是否空闲，并重置已有 Copilot Session，确保新配置在下一次请求生效。CodeBuddy 每次请求都会从本地配置构建 MCP Server 清单。

## Agent Skills

导入时选择一个包含 `SKILL.md` 的目录。文件需要有 YAML frontmatter：

```yaml
---
name: review-code
description: Review code changes for correctness and maintainability.
---
```

应用会校验 Skill ID 和描述，拒绝符号链接，并限制单文件与整个目录大小。导入后复制到应用管理目录；删除安装副本不会删除原始目录。启用的 Skill 正文会加入新 Agent Session 的系统指令上下文，并保留 frontmatter 作为元数据而不重复注入。

Skill 包中的脚本或命令不会由导入器执行。Skill 内容属于用户提供的任务指引，不能覆盖应用级安全规则。

## 运行时与权限

MCP 和 Skill 状态通过主进程 IPC 管理；每个 handler 都校验可信 renderer frame。修改操作要求 Agent、Schedule 和 Task 切换均处于空闲状态。MCP 服务仅在有效工具权限为 `allow-all` 时注册；有效权限仍受 Expert 权限上限约束。

配置变化不需要重启整个 Electron 应用。Copilot Session 会在下一次请求前重建；CodeBuddy 从更新后的配置创建下一次 query。
