# Claude Code Plugin Host 与运行时设计

**状态：** Claude Plugin 导入、Copilot SDK / CodeBuddy 原生运行时接入
**插件格式：** 官方 Claude Code Plugin 目录结构
**应用范围：** 本地单用户 Electron Agent Desktop

## 1. 设计目标

应用负责插件导入、结构校验、启用状态、独立运行授权和权限边界；Provider 原生插件运行时负责加载 Hooks、MCP、LSP、Skills、Commands、Agents 与插件脚本。Electron 主进程和 Renderer 不直接加载第三方插件代码。

- 导入、启用和运行授权是不同状态。导入或启用不会执行代码。
- Copilot SDK 和 CodeBuddy 都使用各自原生的 --plugin-dir 参数。
- 插件必须启用、单独获准、全局权限为 Allow all，且 Expert 未收紧权限，才会进入 Provider。
- 运行授权绑定插件目录的 SHA-256 内容指纹；任一文件变化都会令旧授权失效。
- Provider 只接收通过指纹校验的会话临时快照，不直接运行可变安装目录。
- 插件脚本、Hook、MCP 响应均为不可信输入；不能覆盖宿主权限、IPC 校验或高风险操作策略。

## 2. 组件覆盖

| Claude Plugin 组件 | Copilot SDK | CodeBuddy |
|---|---|---|
| Skills | 原生 Skill loader | 原生 Skill loader |
| Commands | 原生 Legacy Plugin loader | 原生命令 loader |
| Agents | 原生 Agent loader | 原生 Agent loader |
| Hooks | 原生 Hook runtime | 原生 Hook runtime |
| MCP Servers | 原生插件 MCP loader | 原生插件 MCP loader |
| LSP Servers | 原生 LSP loader | 原生 LSP loader |
| Scripts / bin | Bash 与 Hook 插件脚本链路 | 原生脚本及 bin/ PATH |
| Mods | 不支持 CodeBuddy Mods | 原生 TypeScript Mod runtime |

Copilot 的 Legacy Plugin loader 支持 Skills、Commands、Agents、Hooks、MCP、LSP 和脚本；不要把 SDK SessionConfig 的 pluginDirectories 当成 Claude Plugin 目录入口，该字段用于 Agent Plugins / Open Plugin Spec 语义。

## 3. Provider 文件格式适配

### 3.1 Copilot Legacy Plugin

Copilot 的 Legacy Plugin loader 使用根级 plugin.json、hooks.json、.mcp.json 和 lsp.json。Claude 插件常见布局为 .claude-plugin/plugin.json、hooks/hooks.json、.mcp.json 和 .lsp.json。

应用不会改写已安装插件。每次启动 Copilot 时，先将插件复制到应用临时运行目录，再在副本中：

- 从 .claude-plugin/plugin.json 生成 Copilot 根级 plugin.json，忽略可能与 Claude manifest 不一致的旧 root manifest。
- 将默认 hooks/hooks.json 复制为 root hooks.json；manifest 声明自定义 Hooks 文件或内联配置时，解析后生成 root hooks.json。
- 将 manifest 的自定义 mcpServers 配置合并到 .mcp.json。
- 将 manifest 的自定义 lspServers 配置合并到 .lsp.json，再为 Copilot 生成 lsp.json 别名。
- 如果 manifest 未声明 commands 而包内存在标准 commands/ 目录，显式加入该目录；原有自定义 commands 声明保持不变。
- 把 Claude 的 CLAUDE_PLUGIN_ROOT 引用转换为 Copilot 的 PLUGIN_ROOT，覆盖 POSIX、PowerShell、cmd 以及常见 Node.js / Python 环境变量写法。CLAUDE_PLUGIN_DATA 保持原样，Copilot 支持该兼容别名。

所有转换仅在临时副本中执行。Copilot Client 退出后删除临时目录。

### 3.2 CodeBuddy

CodeBuddy 原生接收 Claude 插件目录。SDK query 的 extraArgs 是选项映射而不是 argv 数组，因此应用使用 CodeBuddy 文档化的 CODEBUDDY_PLUGIN_DIRS 环境变量传入会话快照目录；该变量与重复的 --plugin-dir 参数等价。应用先删除继承值，再仅写入注册表批准且指纹验证通过的快照路径。

CodeBuddy 使用未经格式转换的 Claude Plugin 快照，原生加载 Skills、Commands、Agents、Hooks、MCP、LSP、bin/ 脚本和 TypeScript Mods。

## 4. 授权模型

每个插件在本地注册表中维护：

- enabled：是否启用插件资源。
- runtimeApproved：用户是否单独允许运行该插件的第三方代码。
- runtimeApprovalHashes：用户授权时记录的插件目录 SHA-256 指纹。

Provider 运行插件必须同时满足：

1. 插件已启用。
2. runtimeApproved === true。
3. 当前插件内容指纹与已批准的 SHA-256 完全一致。
4. Agent 全局权限为 allow-all。
5. 当前 Expert 没有以 allowAllTools === false 收紧权限。
6. 当前 Expert 的 Skills 白名单覆盖该插件全部原生加载 Skills。
7. 当前 Provider 是 Copilot 或 CodeBuddy。

若 Expert 只选择某插件部分 Skills，宿主继续根据 Expert 白名单注入 Markdown，但不启动该插件的原生运行时，避免原生 Skill loader 暗中暴露未选择的 Skills。

任何文件内容变化都会令指纹校验失败，旧运行授权自动失效。用户需要重新检查插件并授权。禁用或删除插件会撤销运行授权并删除关联指纹。

注册表使用 v3 格式。v1/v2 迁移时保留 enabled 状态，但旧布尔运行授权不会迁移成有效授权。

## 5. 运行时快照与生命周期

plugin-content.ts 提供统一的内容指纹和快照功能：

1. 对安装目录的相对路径、文件类型和文件内容计算 SHA-256。
2. 将已批准插件复制到一次性会话运行目录。
3. 对复制后的快照重新计算 SHA-256。
4. 如果快照指纹与批准指纹不一致，阻止 Provider 启动。
5. Provider 只接收快照路径，不接收可变安装目录。

Copilot 使用 SDK RuntimeConnection.forStdio({ args }) 在 Client 创建阶段传入重复的 --plugin-dir 参数。Copilot Client 的 baseDirectory 指向应用私有目录，避免依赖用户个人 Copilot 配置目录中的插件。

CodeBuddy 每次 Query 创建独立临时目录，把验证后的快照路径写入 CODEBUDDY_PLUGIN_DIRS。Query 的 finally 清理该目录以及临时配置文件。

切换 Workspace、Expert 或会话时，Copilot Agent 先停止旧 Client 并清理快照。启用、禁用、运行授权变更和删除插件的 IPC 操作要求 Agent 空闲，并重置会话，避免旧进程持有过期插件。

## 6. Copilot 的最小工具权限

应用以 SDK mode: empty 创建 Copilot Client。默认不开放运行时内置工具。

只有插件运行授权通过后，Session 才会：

- 启用 Skills loader。
- 开放 bash、skill、task 三个最小内置工具，分别用于插件脚本、Skill 调用和自定义 Agent 调度。
- 将工作目录限定在所选 Workspace；未选择 Workspace 时使用应用私有 Copilot 会话目录。
- 将插件 MCP 工具加入该 Session 可用 MCP ToolSet。

未满足运行授权条件时，不开放 Bash、Skill、Task，也不向 CLI 传入插件目录。

## 7. 沙箱边界

### Copilot

插件获准后，Session 创建时请求 sandbox policy：

    enabled: true
    allowBypass: false
    sandboxMcpServers: true
    sandboxLspServers: true

该策略在 MCP / LSP 和 Session 工具启动前提供。实际隔离是否生效依赖目标机器上的 Copilot CLI/runtime 版本和宿主平台能力；不应仅凭配置存在就声称所有插件行为已处于 OS 沙箱。管理员 Policy Hooks 属于机器级策略，不是插件内容，可能在宿主执行。

### CodeBuddy

在 macOS/Linux 且存在获批插件时，应用生成临时配置：

    sandbox.enabled = true
    sandbox.autoAllowBashIfSandboxed = true
    sandbox.allowUnsandboxedCommands = false

CodeBuddy Bash sandbox 只约束 Bash 命令执行环境，不代表所有 Hook、MCP、LSP 和 Mod 子进程都经过同一个 OS 沙箱。Windows 当前没有 CodeBuddy Bash sandbox，获批插件子进程可能以当前用户权限运行。

两家 Provider 的原生沙箱都不是抵御恶意插件的完整 OS 隔离保证。应用不会设置 CODEBUDDY_IS_SANDBOX，也不会在 Electron 主进程或 Renderer 中执行插件 JavaScript。

## 8. 导入校验

插件导入阶段：

- 仅接受 Claude Code Plugin 目录格式，不接受已废弃的应用自定义 manifest.json。
- 拒绝符号链接、路径穿越和不支持的文件类型。
- 单个文件最大 2 MiB，插件包最大 20 MiB。
- 检查 Hooks / MCP / LSP 自定义配置路径必须位于插件根目录内；允许带或不带 ./ 的包内相对路径。
- 识别默认 hooks/hooks.json、.mcp.json、.lsp.json 及 manifest 内联配置。
- 展示 Hook event、MCP server、LSP server、脚本数量和 Mod 注册入口。

## 9. 可观测性与后续增强

Copilot Trace 记录实际加载的插件 ID 与 sandbox policy；CodeBuddy Trace 记录本次 Query 使用的插件 ID，不记录绝对插件目录和插件密钥。临时快照在 Provider 生命周期结束时清理。

如果需要将每个 Hook、MCP、LSP 子进程提升到强隔离级别，仍需统一的 OS Sandbox Backend，分别实现 macOS、Linux、Windows 的文件系统、网络、进程和资源限制，并确认 Provider 能将每个扩展子进程纳入该后端。在此之前，不把 Provider 原生加载描述为所有插件子进程均已沙箱化。