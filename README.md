# Architect Agent Desktop

A cross-platform Electron desktop application. The first milestone is a built-in, multi-tab Chromium browser that will serve as the foundation for the desktop agent workspace.

## Current scope

- Multi-tab browsing with tab creation, switching and closing.
- Address bar with direct navigation and web search.
- Back, forward, reload and stop controls.
- Links opened by websites in new windows are opened as new tabs.
- Persistent browser profile for cookies, cache and site storage.
- File downloads through Chromium's native download flow.
- Find in page, page context menu and common browser keyboard shortcuts.
- Per-session permission prompts for media, screen capture, geolocation, notifications and clipboard read.
- Isolated browser processes: remote pages do not receive Node.js access.
- Local project workspaces: select a directory from the toolbar, restore it on launch, and keep Agent conversations separate per project. CodeBuddy uses the selected directory as its working directory; Copilot exposes permission-gated workspace file tools.
- Local declarative plugin directories: import, validate, enable/disable, export and remove. Enabled plugin Skills and Workflow templates are included in Agent instructions; plugins cannot execute arbitrary code.
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
- **Plugin host:** stores local plugin directories under the application user-data directory, validates manifests and referenced resources, and exposes only host-known tool/view identifiers. Plugin content is data, never executable code.

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

在 Agent 面板工具栏或原生菜单 Agent 中打开「Session Explorer」（macOS `⌘⇧E` / Windows `Ctrl+Shift+E`）；Agent 配置为 `⌘⇧,` / `Ctrl+Shift+,`，显示或隐藏 Agent 面板为 `⌘⇧A` / `Ctrl+Shift+A`。菜单由 Electron 原生应用菜单统一管理，可继续扩展快捷键和命令。Session Explorer 使用独立 Electron 窗口，不会被嵌入式浏览器 WebContentsView 覆盖。默认进入执行 Trajectory：按 Turn/Step 查看用户输入、模型请求/回复、工具调用/结果、权限事件和真实耗时；可选中步骤检查原始输入、输出与关联事件。另有独立的 Context Explorer 标签，复用 common-agent-lib 的 ContextDebugger，检查模型上下文、运行事件、工具链、LLM Calls、最新 Context 和 Context Diff。窗口打开期间会持续刷新。Token 用量仅在 Provider 实际返回 usage 数据时展示；Copilot/CodeBuddy 当前记录的是桌面端到 SDK/CLI 的可见输入，不代表 Provider 最终 HTTP 请求，未暴露的上下文会标记为不完整，不会进行 Token 或 Context Window 估算。会话消息逐条保存在 SQLite session_messages 表中，不再受旧版 200 条消息截断影响。详见 [ADR-003](docs/architecture/adr/ADR-003-session-explorer.md) 和 [Trajectory 与 Context Explorer 设计](docs/architecture/AGENT-TRAJECTORY-AND-CONTEXT-EXPLORER.md)。

## Agent Runtime 与 Code Mode

Runtime 基础设计、Code Mode 执行链路、Capability API，以及动态代码的安全边界见 [Agent Runtime、Code Mode 与安全沙箱设计](docs/architecture/AGENT-RUNTIME-AND-SANDBOX.md)。当前 Code Mode 的 `execute_code` 只在 Allow all 模式开放，使用独立 Electron UtilityProcess 执行模型生成的 JavaScript。UtilityProcess 不是安全沙箱；生成代码仍可能使用当前用户权限访问 Node.js API 和本机资源。Main Process Tool Broker 只对声明 API 的调用实施权限校验，不能约束生成代码直接调用 Node.js API。Code Mode 仅用于编排当前已授权工具，不应被描述为 OS 级隔离。现有插件仍是声明式资源，不会因导入而执行 JavaScript。

## Plugins

Open **Agent 与插件配置** from the application settings, then import a plugin directory. The repository includes a working example at `examples/plugins/research-assistant`.

A plugin directory contains `manifest.json` plus the resource files referenced by that manifest. The first version supports Skills (`.md`), Workflow templates (`.md` or `.json`), references to host-provided tools, and JSON declarations for the existing Browser or Agent views. Arbitrary JavaScript is never loaded or executed.

Imported plugins are stored locally under the application's user-data directory. Enable/disable state is local to this installation. Export writes a copy of the plugin directory to a folder you choose.

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
