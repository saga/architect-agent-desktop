# ADR-010：Workspace 范围内自主执行与权限边界

- 状态：Accepted
- 日期：2026-11-23

## 背景

当前权限档位把 workspace_write_file 限定在 Allow all。Agent 即使只需要修改当前项目源码，也必须获得包含 Shell、浏览器脚本注入等能力在内的广泛权限。这把“在项目目录内工作”与“访问当前用户的完整操作系统权限”绑定在一起，交互成本过高。

同时，UtilityProcess 只提供进程和故障隔离，不是安全沙箱；Worker 仍以当前用户身份运行。Tool Broker 只能约束经由 Broker 的调用，不能限制 Worker 直接使用 Node.js API。因此，不能仅为减少审批而把 Shell 或任意代码执行放入自动执行范围。

## 决策

新增 workspace 权限档位，作为 Assisted 与 Allow all 之间的能力边界：

1. Browser 基础工具继续可用。
2. 当前 Task 绑定 Workspace 时，Agent 可自动使用 Host-mediated Workspace list/read/search/write 工具。
3. Workspace 文件操作必须通过 Main Host Handler；路径必须相对当前 Workspace，Host 拒绝路径穿越、绝对路径和符号链接，并继续执行文件大小、文件描述符身份等检查。
4. Workspace 授权与 Expert 权限上限、Expert 工具 allowlist 取交集。Expert 不得提升全局权限。
5. CodeBuddy 原生 Shell、原生文件工具、MCP、插件可执行运行时、浏览器 JS/CSS/CDP 和 execute_code 不因该档位而开放。
6. 没有当前 Workspace 时，文件工具失败关闭，不得回退到 Home、应用数据目录或 Provider 默认工作目录。
7. 用户显式选择 Workspace 档位后，该设置持久化；实际文件资源范围在每个 Task 执行时绑定到该 Task 的 Workspace。

默认权限仍为 No tools。本 ADR 不引入默认自动授权，也不改变既有 Allow all 语义。

## 授权模型

当前阶段采用确定性权限判定，不在每次工具调用前调用 LLM 做风险判断。已授予且在 Workspace 范围内的操作自动执行；不在权限档位或 Expert allowlist 内的工具不向模型暴露；超出 Workspace 边界的请求由 Host 拒绝。

这是一种显式的持久化能力档位，不是逐路径 Grant 数据库，也不是 Copilot CLI 完整 Permission Rules 的实现。

## 后果

日常项目文件修改不再要求开启完整 Allow all，也不再需要逐次 Diff 审批。Workspace 授权允许覆盖当前项目内文件，用户应只选择信任的项目目录。当前不提供自动 Shell 执行、按路径单独记忆授权、临时越界审批或网络白名单。

## 后续工作

- 为 Workspace 路径引入独立、可撤销的 Capability Grant。
- 设计统一 Ask/Allow/Deny 决策接口，但常规已授权操作不逐次弹窗。
- 评估 macOS 与 Windows 的 OS Sandbox Backend，覆盖文件系统、网络、凭据、进程树和资源限制。
- 只有在 Sandbox 边界经跨平台测试验证后，才考虑在 Workspace 模式内开放受限命令执行。

## 验收标准

- Workspace 档位开放 Host Workspace list/read/search/write。
- Workspace 档位不开放 CodeBuddy 原生 Bash/文件工具、MCP、插件可执行运行时、浏览器 JS/CSS/CDP 和 execute_code。
- Expert 权限上限和 allowlist 仍能收紧权限。
- No tools、Browser only 和 Assisted 的既有行为不被扩大。
- 无 Workspace、路径穿越、绝对路径和符号链接请求失败关闭。
- 权限矩阵有单元测试。
