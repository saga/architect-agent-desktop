# Architect Agent Desktop

A cross-platform Electron desktop application. The first milestone is a built-in, multi-tab Chromium browser that will serve as the foundation for the desktop agent workspace.

## Current scope

- Multi-tab browsing with tab creation, switching and closing.
- Open the current page in an installed Google Chrome from the toolbar; if Chrome is not detected, fall back to the operating system's default browser. The built-in browser continues to use Electron's bundled Chromium.
- Address bar with direct navigation and web search.
- Back, forward, reload and stop controls.
- Links opened by websites in new windows are opened as new tabs.
- Persistent browser profile for cookies, cache and site storage.
- File downloads through Chromium's native download flow.
- Find in page, page context menu and common browser keyboard shortcuts.
- Per-session permission prompts for media, screen capture, geolocation, notifications and clipboard read.
- Isolated browser processes: remote pages do not receive Node.js access.
- Local project workspaces: select a directory from the toolbar, restore it on launch, and keep Agent conversations separate per project. CodeBuddy uses the selected directory as its working directory; Copilot exposes permission-gated workspace file tools.
- Claude Code Plugins: import and manage official Claude Code Plugin directories. Both Copilot SDK and CodeBuddy use their native `--plugin-dir` plugin runtime for Skills, Commands, Agents, Hooks, MCP and LSP; both also support bundled scripts, while CodeBuddy additionally supports Mods. Runtime code requires separate per-plugin approval, a matching SHA-256 content fingerprint, global Allow all and an Expert that does not narrow the permission ceiling.
- Agent Data: persist Session snapshots, request lifecycle, provider events and tool call inputs/results in a local SQLite trace store. The data directory defaults to userData/agent-data and can be changed in Agent settings.

This is the browser foundation, not a complete replacement for Chrome, Edge or Firefox. Browser extensions, cross-device sync, password import, bookmark management and advanced privacy controls are not included yet.

## Requirements

- Node.js 24.5+.
- npm.

- macOS or Windows for native packaging. Development can also run on Linux.

## Development

    npm install
    npm run dev

The Vite renderer and Electron main process run as separate development processes.

## Build

    npm run typecheck
    npm run build

The compiled application is written to the dist/ directory.

## Package for desktop

Packaging does not require Rust, Cargo, a WASI target or a separate code-execution runtime.

On macOS:

    npm run package:mac

This produces DMG and ZIP distributions for Apple Silicon and Intel Macs.

On Windows:

    npm run package:win

This produces a per-user NSIS installer and a portable executable for x64 and ARM64.

### Running without administrator privileges

**Windows:** the NSIS installer is configured for per-user installation (perMachine: false) and does not request elevation. The portable build can be run without installing the application.

**macOS:** use the ZIP or DMG build and keep the application in a directory writable by the current user, such as ~/Applications. Moving an app into the system-wide /Applications directory may require an administrator depending on the machine's policy. The app does not install privileged services or system-wide components.

Unsigned builds may trigger the operating system's normal security warnings. Production distribution should add code signing and notarization; signing credentials are intentionally not included in this repository.

## Architecture

- **Main process:** owns the application window, tab lifecycle, navigation, downloads, permission prompts and native menus.
- **Browser content:** each tab is a WebContentsView. Tabs share one persistent Chromium session while keeping separate web contents.
- **Preload:** exposes a narrow, typed IPC API using contextBridge; it does not expose raw Electron APIs.
- **Renderer:** local React UI for the tab strip, navigation toolbar, address bar, project workspace selection and Agent/plugin settings.
- **Project workspace:** stores the selected local project directory independently from the Layout Engine and maintains a separate Agent transcript for each workspace.
- **Agent Data:** stores runtime events and Session evidence separately from project files. SQLite trace storage can be queried by Session, Trace and event type; the user can change its local directory.
- **Plugin host:** stores and validates Claude Code Plugin directories under the application user-data directory. Markdown is instruction data; native Copilot SDK and CodeBuddy plugin runtimes receive only separately approved plugin directories and only while global Allow all and the active Expert permission ceiling permit it. Copilot receives a temporary compatibility projection for its root legacy manifest and LSP filename; imported source files remain unchanged.

Remote pages run with nodeIntegration: false, contextIsolation: true and sandbox: true. The renderer is not allowed to send arbitrary IPC messages; only the methods in the preload API are exposed.

## Local project workspace

Choose **打开工作区** in the main toolbar to select a local project directory. The selected directory is restored on restart, becomes the Agent working directory where supported, and has its own conversation history. See [本地项目工作区设计](docs/architecture/LOCAL-WORKSPACE.md) for permission behavior and file boundaries.

## Pure Agent 工作模式

除浏览器右侧 Sidepanel 外，可以切换到 Pure Agent 三栏工作区。左侧按 Workspace 文件夹组织多个 Task，并提供 Schedule、Expert 和配置入口；中间保留每个 Task 独立的 Agent 对话；右侧可选显示内置浏览器、Workspace 文件和任务结果。右侧默认关闭，三栏宽度可拖动调整。

Task、对话、Expert、定时任务和运行记录均保存在本机。Expert 是可复用的任务工作模式，可绑定工作方法与输出约束、Plugin Skills、工具白名单和权限上限；它不提升模型本身的能力，也不能突破 Agent Settings 的全局工具权限。全局工具权限与 Expert 工具授权都默认 No tools；工具必须明确选择，或在 Expert 中主动开启 Allow all tools。角色提示的研究证据和 Profile 设计建议见 [Expert 工作模式与角色提示研究](docs/architecture/EXPERT-WORK-MODES-AND-PERSONA-RESEARCH.md)。定时任务支持一次、按间隔、每天、每周/双周、每月和每年执行，可编辑、暂停/恢复、立即运行，并查看每次运行结果与对应会话；本地调度器只在桌面应用运行期间工作，不保证应用退出或系统休眠时执行，也不会逐次补跑错过的周期。详细设计见 [Pure Agent 工作界面](docs/architecture/PURE-AGENT-WORKSPACE.md)。

## Agent Data 与运行记录

默认数据目录为 Electron userData 下的 `agent-data/`，主要文件为 `agent-traces.sqlite`。可在「Agent 与插件配置」中更改目录。切换目录不会搬移或删除旧目录的数据；之后的新事件写入新目录。

记录内容包括用户输入与可见会话快照、模型输出增量、Provider 运行事件、工具调用参数和结果、错误、请求状态及工作区上下文。事件会按 Trace 关联并分配本地序号，敏感字段会在写入前脱敏，超过 1 MiB 的事件会标记为不完整。

这是一份本地运行轨迹与诊断证据，不是防篡改的合规审计账本。SDK 未提供的模型传输层请求、授权决策或外部副作用，不会被推断为已记录。

### Session Explorer

在 Agent 面板工具栏或原生菜单 Agent 中打开「Session Explorer」（macOS `⌘⇧E` / Windows `Ctrl+Shift+E`）；Agent 配置为 `⌘⇧,` / `Ctrl+Shift+,`，显示或隐藏 Agent 面板为 `⌘⇧A` / `Ctrl+Shift+A`。菜单由 Electron 原生应用菜单统一管理，可继续扩展快捷键和命令。Session Explorer 使用独立 Electron 窗口，不会被嵌入式浏览器 WebContentsView 覆盖。默认进入执行记录：每次用户请求或定时任务显示为一张 Run 卡片，概览请求内容、状态、耗时、模型与工具调用；展开后查看模型请求/响应、工具调用/结果和原始输入输出。Task/Session 的创建、切换和保存等系统活动单独放在活动事件中，不再混入执行 Run。另有 Context Explorer 标签，复用 common-agent-lib 的 ContextDebugger，检查模型上下文、运行事件、工具链、LLM Calls、最新 Context 和 Context Diff。窗口打开期间会持续刷新。Token 用量仅在 Provider 实际返回 usage 数据时展示；Copilot/CodeBuddy 当前记录的是桌面端到 SDK/CLI 的可见输入，不代表 Provider 最终 HTTP 请求，未暴露的上下文会标记为不完整，不会进行 Token 或 Context Window 估算。会话消息逐条保存在 SQLite session_messages 表中，不再受旧版 200 条消息截断影响。详见 [ADR-003](docs/architecture/adr/ADR-003-session-explorer.md) 和 [Trajectory 与 Context Explorer 设计](docs/architecture/AGENT-TRAJECTORY-AND-CONTEXT-EXPLORER.md)。 Claude Desktop / Cowork 的功能差距和优先级见 [Claude Desktop Gap Analysis](docs/architecture/CLAUDE-DESKTOP-GAP-ANALYSIS.md)。

## Agent Runtime 与 Code Mode

Runtime 基础设计、Code Mode 执行链路、Capability API，以及动态代码的安全边界见 [Agent Runtime、Code Mode 与安全沙箱设计](docs/architecture/AGENT-RUNTIME-AND-SANDBOX.md)。当前 Code Mode 的 `execute_code` 只在 Allow all 模式开放，使用独立 Electron UtilityProcess 执行模型生成的 JavaScript。UtilityProcess 不是安全沙箱；生成代码仍可能使用当前用户权限访问 Node.js API 和本机资源。Main Process Tool Broker 只对声明 API 的调用实施权限校验，不能约束生成代码直接调用 Node.js API。Code Mode 仅用于编排当前已授权工具，不应被描述为 OS 级隔离。现有插件仍是声明式资源，不会因导入而执行 JavaScript。


## Agent 数据分析、可视化与 Memory Dreaming

Agent 支持从系统文件选择器读取 PDF、Word、Excel、CSV、TSV、JSON 和文本文件。表格数据可导入按 Workspace 隔离的本地 DuckDB，模型只能通过受限的只读 SQL 查询已导入的数据；扫描版 PDF 当前只提示没有可提取文本，暂不执行 OCR。

新会话的结构化 UI 使用 **A2UI 1.0**，由官方 Agent/Core SDK 与本地白名单 Finance Catalog 生成和校验；旧会话仍保留 A2UI v0.9 / Ant Design X Card 渲染。Finance Catalog 提供三类专业组件：

- **FinanceChart**：Ant Design Charts，用于收益、风险、分布、双轴和流程型数据图表。
- **KnowledgeGraph**：AntV G6，用于只读实体关系、持仓穿透和知识网络。
- **WorkflowDiagram**：AntV X6，用于流程、审批链路和数据血缘；编辑后的图必须通过安全校验才会回传 Agent。

长期记忆由 Transcript、Memory Notes、主题知识页和有限上下文注入构成。Memory Dreaming 可从当前 Workspace 的对话记录准备一份固定证据集，脱敏后整理成功经验、失败教训、项目约定和长期偏好，并以原子事务提交。每项变更必须引用当前证据并记录理由；更新已有 Note 要通过版本检查。提交失败不会推进游标；待处理 Run 可以放弃，最近一次成功 Run 可在没有后续冲突时回滚。Dreaming 也支持空变更提交，表示本批历史已评估但没有长期知识需要保存。

在「Agent 与插件配置 → Memory & Dreaming」中可以查看 Notes、知识页、关系、证据和变更快照，也可以置顶、归档、放弃待处理 Run 或回滚最近一次整理。Dreaming 工具需要当前 Task 使用的 Expert 开启「长期记忆」工具组，并将工具权限设置为 assisted 或 allow-all；工具仍受当前 Workspace 范围限制。

详细设计、数据边界和当前限制见 [Agent 数据分析、文件理解、A2UI 与长期记忆设计](docs/architecture/AGENT-ANALYTICS-DOCUMENTS-A2UI-MEMORY.md)。当前不包含后台定时 Dreaming、跨 Workspace 全局记忆、向量检索、扫描 PDF OCR 或防篡改审计账本。

## Claude Code Plugins

The plugin manager imports the official **Claude Code Plugin directory format**. The manifest is `.claude-plugin/plugin.json`; standard directories and files such as `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json` and `bin/` remain in the imported package.

Browse [Claude Marketplace](https://claude.com/marketplace/plugins), select plugins marked **Works with: Claude Code**, obtain the plugin source directory, then choose **Agent 与插件配置 → Plugins → 导入 Claude Plugin 目录**. Import the plugin root directory, not the marketplace catalog folder.

Both providers use their own native plugin runtime. CodeBuddy loads the approved Claude Plugin snapshot directly through `CODEBUDDY_PLUGIN_DIRS` (equivalent to repeated `--plugin-dir` arguments), including TypeScript Mods and automatically adding `bin/` to PATH. Copilot uses its Legacy Plugin loader through repeated `--plugin-dir` arguments; the app stages a temporary compatibility projection with a root `plugin.json`, `hooks.json`, `.mcp.json`, merged `lsp.json`, converted `*.agent.md` Agent files and generated command directories for inline/source Commands. Copilot supports Skills, Commands, Agents, Hooks, MCP and LSP, but not CodeBuddy Mods or automatic `bin/` PATH injection; shell scripts must be called explicitly by a supported Hook or command configuration. The installed plugin source remains unchanged.

Importing or enabling a plugin never executes code. Loading it into a Provider requires all of: the plugin is enabled, its own “允许加载” approval is on (this also applies to Markdown-only Skills/Commands/Agents), the approved SHA-256 fingerprint still matches the complete plugin tree including file mode bits, global Agent permission is **Allow all**, and the selected Expert does not narrow that permission or its Skill allowlist. When a changed or unsafe tree is detected, its approval is cleared and must be granted again even if the old files are restored. Each Provider receives a verified session snapshot instead of the mutable installation directory.

The app never evaluates plugin JavaScript in the Electron main or renderer. For Copilot, an approved session exposes the Bash, Skill and Task built-ins needed by plugin scripts, Skill invocation and custom-Agent dispatch; it enables Skill loading, scopes the working directory to the selected Workspace (or the app's private Copilot session folder), and requests sandboxing with bypass disabled. The app sets `COPILOT_PLUGIN_DIR_ONLY=true` so Copilot cannot silently load unrelated plugins from the user's environment. In the temporary runtime copy, Claude's `CLAUDE_PLUGIN_ROOT` references are translated to Copilot's `PLUGIN_ROOT` in files and inline plugin configuration; `CLAUDE_PLUGIN_DATA` is retained because Copilot supports that alias. CodeBuddy receives the same kind of hash-verified session snapshot through its documented `CODEBUDDY_PLUGIN_DIRS` allowlist; the inherited value is cleared and replaced with only approved snapshot paths. On macOS/Linux, approved CodeBuddy sessions enable its Bash sandbox and reject unsandboxed commands. Copilot sandbox enforcement depends on compatible CLI/runtime and OS support. Do not assume that every Hook child process shares the MCP/LSP sandbox boundary.

These controls are not a claim that every plugin side effect is fully isolated. Copilot sandboxing depends on a compatible CLI/runtime and platform. CodeBuddy's Bash sandbox is not available on Windows, and its Bash sandbox does not prove that every Hook/MCP/LSP/Mod child process is isolated. Only approve plugins from sources you trust. The app does not set CodeBuddy's high-risk `CODEBUDDY_IS_SANDBOX` full-pass environment variable.

Import rejects symbolic links, limits package/file size and validates configured JSON paths. Runtime approval is stored separately from plugin enablement; disabling or removing a plugin revokes its approval and fingerprint. The plugin manager stores packages under the application's user-data directory. Export writes a copy of the plugin directory to a folder you choose.
## 本地数据分析、可视化与长期记忆

Agent 可以通过系统文件选择器分析 PDF、Word（DOC/DOCX）、Excel（XLS/XLSX/XLSM）、CSV、TSV、JSON 和文本文件。Excel/CSV 等结构化数据会导入当前 Workspace 对应的本地 DuckDB，Agent 使用受限只读 SQL 做分析。

**可视化以 A2UI 1.0 为新会话主协议。** 应用使用 A2UI Agent/Core/React SDK 和本地 Finance Catalog：Ant Design Charts 负责统计与金融图表，AntV G6 负责实体关系和知识图谱，AntV X6 负责可编辑流程图、审批流和数据血缘。旧的 A2UI v0.9 卡片继续用于历史会话恢复，不再作为新任务的默认输出方式。

长期记忆按 Transcript、Memory Notes、Memory Representations 和 Injected Context 分层。Memory/Dreaming 页面可以查看 Workspace 的 Note、知识页、关系、证据和 Dreaming Runs；Agent 也提供完整的 prepare、commit、audit、abandon 和 rollback 工具。Dreaming 使用来源 ID、版本前置条件、SQLite 原子事务和变更前后快照；只有成功提交才推进 Transcript 游标。可从 Settings → Memory & Dreaming 手动整理，也可通过 Agent 在重要任务结束时调用 Dreaming 工具。

当前扫描版 PDF 不执行 OCR；PDF 表格结构重建、后台定时 Dreaming、向量记忆和跨 Workspace 全局记忆尚未实现。数据分析、记忆和可视化操作遵循 Agent 权限模式与 Expert 工具白名单。

详细设计见 [Agent 数据分析、文件理解、A2UI 与长期记忆设计](docs/architecture/AGENT-ANALYTICS-DOCUMENTS-A2UI-MEMORY.md)。

持续个性化、偏好学习、按请求相关性召回记忆，以及不依赖 Schedule 的事件驱动主动建议，见 [Personal Intelligence 与主动协助设计](docs/architecture/AGENT-PERSONAL-INTELLIGENCE-AND-PROACTIVE-ASSISTANCE.md)。

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl + T | New tab |
| Cmd/Ctrl + W | Close active tab |
| Cmd/Ctrl + L | Focus address bar |
| Cmd/Ctrl + R | Reload active tab |
| Cmd/Ctrl + F | Find in page |
| Cmd/Ctrl + Tab | Next tab |
| Cmd/Ctrl + Shift + Tab | Previous tab |
| Cmd/Ctrl + 1–8 | Select tab 1–8 |
| Cmd/Ctrl + 9 | Select last tab |
| Alt + Left / Right | Back / forward |

## Notes

- The browser profile is stored under Electron's user data directory.
- Site permission approvals last for the current app session. Unsupported permissions are denied by default.
- No auto-update service, telemetry or remote account service is configured.

## Copilot Agent

The application integrates the official Node.js GitHub Copilot SDK in the Electron main process. The renderer talks to it through a narrow preload API; browser tabs never receive SDK or Node.js access. IPC request payloads are validated with Zod.

The chat surface uses Ant Design and Ant Design X. The SDK's signed-in-user authentication uses stored credentials from a GitHub Copilot CLI login. VS Code sign-in alone is not a documented credential source; sign in to Copilot CLI if the SDK reports that no credentials are available. The SDK package includes its compatible CLI runtime.

The agent panel is docked on the **right side** of the browser. It can inspect the active page (title, URL, visible text, headings, links and controls), list and switch tabs, navigate or open tabs, scroll, click ordinary UI/navigation elements, and fill non-password fields without submitting forms. These browser capabilities are exposed as explicit Copilot SDK tools implemented in the Electron main process; the remote page cannot access them directly.

The agent treats page content as untrusted input. It is intentionally prevented from submitting forms or performing purchases, payments, message sending, publishing, deletion, transfers, or account/security changes. Those consequential actions remain under direct user control.
