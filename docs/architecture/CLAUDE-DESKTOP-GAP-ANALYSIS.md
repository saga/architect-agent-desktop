# 对照 Claude Desktop / Cowork 的产品差距审查

**审查日期：** 2026-11-21  
**审查对象：** `saga/architect-agent-desktop` 当前 `main`  
**外部基准：** Claude Desktop 与 Claude Cowork 的公开产品说明、使用文档和安全架构  
**审查方式：** 对照仓库源码、IPC、Provider/Runtime、持久化、Renderer 界面和现有架构文档；没有把未在代码中找到的功能当作“已支持”。

## 1. 结论

这个项目已经不是一个简单的聊天窗口：它具备内置浏览器、Copilot/CodeBuddy Provider、Task/Workspace、Expert 工作模式、MCP、Skills、声明式 Plugin、Code Mode、本地 Trace、运行记录和本地定时任务。

但是，与当前 Claude Cowork 的差异主要不在聊天 UI，而在 **文件工作流完整度、Project 级上下文、成果交付、外部应用连接的产品化、长任务连续性，以及执行环境的安全隔离**。

最需要优先处理的不是增加更多 Agent 按钮，而是：

1. **修正附件语义。** 当前选中的文件实际上只把文件路径拼入 Prompt，没有把文件内容或可解析附件提交给模型；这容易让用户误以为文件已被 Agent 读取。
2. **建立真正的非可信代码安全边界。** 当前 Code Mode 在 Electron UtilityProcess 执行，属于进程/故障隔离，不是安全沙箱。生成代码仍能直接调用 Node.js 文件、网络、环境变量及子进程 API，绕过 Tool Broker。
3. **把 Workspace/Task 升级为 Project 工作上下文。** 当前有目录和独立 Task Transcript，但缺少 Project 级 Instructions、参考文件、持续记忆、知识检索，以及项目定时任务的统一绑定。
4. **建立文件成果（Artifacts）工作流。** 当前以聊天结果和文本文件预览为主，没有独立的成果库、HTML/交互式预览、版本历史和一键导出。
5. **改善 MCP / Connector 安装和授权。** 当前以手工配置 STDIO/HTTP 为主，不具备 Desktop Extension 包安装、依赖封装、目录发现、版本升级和 OAuth 产品化体验。

本审查不建议直接复制 Cowork 的所有功能。这个项目的明确优势是本地单用户、双 Provider、内置浏览器和可控桌面工具。应该先补齐上面五项中与现有方向直接相关的能力，而不是先做团队协作或另一个 Claude Code。

## 2. 功能对照矩阵

状态定义：

- **已有：** 仓库中能找到完整实现路径。
- **部分：** 有基础功能，但和 Cowork 的完整工作流、交互或安全边界存在差距。
- **缺失：** 当前代码中没有找到对应能力。
- **不建议照搬：** 可以作为以后扩展方向，但不是当前桌面单用户 Agent 的必要能力。

| 能力 | 当前项目 | Claude Desktop / Cowork 对照 | 判断 |
|---|---|---|---|
| 桌面 Agent 对话 | React AgentPanel，支持 Copilot / CodeBuddy、Thinking、流式输出、会话持久化 | Cowork 面向多步骤任务委派，而不是只有即时问答 | 已有 |
| 内置浏览器 | Chromium 多标签、导航、页面快照、截图、点击、填写、滚动、只读 CDP | Cowork 优先使用 Connector，再用 Browser，最后才用屏幕交互 | 已有；缺少跨桌面应用操作 |
| Task / Session | Task 独立 Session、SQLite Transcript、Task 切换、历史恢复 | Cowork 支持连续对话和任务级项目上下文 | 部分；当前 Task 之间不会自然继承持续上下文 |
| Project 工作上下文 | Workspace 文件夹 + Task + Expert | Cowork Project 有独立文件、Instructions、Context、Memory 和项目定时任务 | 部分；缺少 Project 实体和知识上下文层 |
| 文件附件 | 文件选择器最多选 20 个路径，Prompt 中只写入路径文本 | Cowork 可直接访问授权本地文件；Claude 也支持直接文件上传和处理 | **缺失 / 语义错误，P0** |
| 本地文件操作 | Workspace list/read/write/search，路径和符号链接校验，读写限额 | Cowork 可在 VM 中处理授权文件夹，提供长任务文件整理与成果生成 | 部分；缺少多文件操作、删除/移动、文件类型处理和细粒度策略 |
| 权限模型 | 全局 No tools 默认拒绝；Expert 工具白名单；Host Tool Broker | Claude Connectors 可按工具类别/单项设置 Always allow、Needs approval、Blocked；Cowork 还有文件范围和删除确认 | 部分；缺少统一的每工具策略与文件访问模式 |
| 代码执行安全 | UtilityProcess 隔离进程，但不是安全沙箱 | Cowork 代码执行使用本地 VM 或云端隔离环境，文件和网络范围受控 | **关键差距，P0** |
| MCP / Connectors | STDIO + HTTP MCP；配置保存在本地 JSON；手动输入 Command/Args/URL/Headers | Connector Directory、Remote MCP、OAuth；Desktop Extensions 可打包本地服务及依赖后单击安装 | 部分；安装、凭据、版本和发现体验明显落后 |
| Agent Skills | 目录导入、ZIP 上传、SKILL.md、启停管理 | Cowork 支持 Skills、项目上下文和插件工作流 | 已有基础；缺少更好的作用域、依赖和版本治理 |
| Plugin | 安全声明式 Manifest，引用宿主 Tools、Skills、Workflow、有限 Host View | Claude Desktop Extensions / Plugins 提供安装包、连接器与组织分发 | 部分；当前声明式插件更安全，但能力与生态较窄 |
| Schedule | 本地周期任务、运行记录、独立 Task/Session、结果回看 | Cowork Scheduled Tasks 可远程运行、查看运行历史，也能使用已连接工具和 Skills | 部分；当前必须应用运行，且不能无设备运行 |
| 跨设备派发 | 无移动端入口、无远程任务派发 | Dispatch 可从手机派发到桌面；同一持续会话可跨设备查看结果 | 缺失；本地单用户产品可暂缓 |
| 子 Agent / 并行工作流 | Code Mode 可并行调用工具，但没有独立子 Agent 生命周期和委派 UI | Cowork 可拆分复杂任务并并行运行多个 workstreams / sub-agents | 缺失；先做可审计的 Task DAG 比先做多 Agent UI 更有价值 |
| Artifacts / 成果管理 | 右侧 Results 展示 Assistant/Error 消息；Files 主要预览文本文件 | Cowork Live Artifacts 是独立持久 HTML 页面，可刷新数据并保留版本历史 | **明显缺失，P1** |
| 运行轨迹与 Context | SQLite Agent Trace、Trajectory、Context Explorer、原始事件 | Cowork 展示计划、步骤和进度，支持任务中途 steering；企业可接 OTel / Compliance 观测 | 已有基础；需要继续完善可读性、长任务阶段及恢复状态 |
| Voice / Dictation | 当前 Agent 输入区未找到麦克风/语音入口 | Claude Desktop 提供 dictation；Computer Use / connectors 等还存在平台差异 | 缺失；低优先级 |
| 团队协作 / 云同步 | 本地单用户，Task/Expert/Plugin/Data 不同步 | Claude Team/Enterprise 有 Project 分享、组织级 Connector/Skills/策略和审计 | 不建议短期照搬；与本项目单用户定位不符 |

## 3. 当前代码里已经存在的能力

这部分不是待办清单，避免把已有功能重复建设。

### 3.1 Agent 与工作区

- `AgentPanel.tsx`：Copilot / CodeBuddy 对话、消息流、Reasoning、工具状态、附件路径选择和当前网页引用。
- `PureAgentWorkspace.tsx` / `PureAgentSidebar.tsx`：Pure Agent 三栏工作界面、Task、Workspace、Expert、Schedule 导航。
- `agent-workspace-store.ts`：Task、Expert、Schedule 和用户偏好持久化。
- `agent-session.ts` 与 `agent-trace-store.ts`：Session Transcript 和 SQLite Trace 持久化。

Task 切换会重置 Provider Session，避免不同 Task 的 SDK Transcript 串线；这对本地隔离有帮助，但不等于一个 Project 的持续记忆。

### 3.2 Browser / Tools / Runtime

- `copilot.ts` 暴露 Browser、Workspace 以及 Code Mode 工具。
- `browser-cdp.ts` 只暴露经过 allow-list 的只读 CDP 方法。
- `runtime/runtime-capabilities.ts` 提供 Workspace list/read/write，并校验路径、符号链接和文件大小。
- `runtime/utility-process-runtime.ts` 执行 Code Mode / trusted Skill。
- `runtime/codemode.ts` 定义工具编排描述和 Tool Broker。

要注意：Broker 只约束通过 Broker 调用的工具，不会拦截在 UtilityProcess 内直接使用 Node.js API。

### 3.3 扩展

- `agent-extensions.ts` 支持 MCP STDIO / HTTP 配置、Agent Skills 目录和 ZIP 导入。
- `plugin-registry.ts` 限定声明式 Plugin Manifest，插件 View 只能引用宿主声明的 browser / agent 视图。
- MCP 环境变量通过当前进程环境解析，不应把真实密钥直接写在配置文件或仓库中。

### 3.4 Schedule / Trace

- 本地调度支持一次、分钟间隔、每天、每周/双周、每月和每年。
- 每次 Schedule Run 建立独立 Task、Session、Trace，并保存结果。
- Session Explorer 从本机 SQLite 读取消息与 Trace，不依赖云端服务。

## 4. 真实缺口与风险分析

### P0 — 附件并没有真的附加内容

当前实现位于 `src/renderer/AgentPanel.tsx`：

1. `agentPickFiles()` 通过 Electron 文件选择对话框返回路径。
2. Renderer 将路径保存到 `attachments`。
3. 发送时，`effectivePrompt` 只包含：

   `Attached files:` + 文件路径列表。

4. Main Process 没有在此流程读取文件内容，也没有把文件作为模型支持的 multimodal/document attachment 传入 Provider。

因此，当前 UI 的“已添加附件”并不等于 Agent 已经读取文件。若路径不在当前 Workspace 内，Agent 甚至没有工具权限读取它。

**建议实现：**

- 将附件变成真正的数据对象：`id / displayName / canonicalPath / size / mimeType / ingestStatus`。
- 选择后由 Main Process 检查路径、文件类型、大小、符号链接和用户授权范围。
- 文本、PDF、Office、图片分别走独立的解析与上下文构建适配器；不要把文件路径塞进 Prompt 代替文件内容。
- 明确区分“已选择、正在解析、可供模型使用、解析失败”。
- Trace 记录附件元数据和解析摘要，不把完整敏感文档内容无条件写入审计日志。
- 对 Provider 不支持的文件格式，先在本机转换为可控的文本/图像内容，再按 Provider 能力传递。

### P0 — Code Mode 不是安全沙箱

`AGENT-RUNTIME-AND-SANDBOX.md` 已明确说明：Electron UtilityProcess 提供进程隔离和崩溃隔离，不构成恶意代码安全边界。它仍然以当前用户身份运行，可以访问 Node.js 文件、环境、网络和子进程 API。

这意味着：

- 把工具权限改成 No tools，只能限制 Host Tool Registry，不等于阻止任意生成代码直接调用 Node API。
- 把 `execute_code` 放进 UtilityProcess，不足以抵御 Prompt Injection 或模型生成的恶意代码。
- 不能把 “Code Mode 只能用 declared APIs” 的 System Prompt 当作强制权限边界。

**建议实现：**

- 将 Generated Code 与 Trusted Skill 分开运行，保持当前 trusted Skill 路径明确标记为“仅限用户信任代码”。
- 为 Generated Code 建立真正的 OS 级隔离环境：macOS Sandbox / 受限容器或 VM、Windows AppContainer/Restricted Token/Job Object；按平台提供一致的 Runtime Contract。
- 文件系统只挂载选定 Workspace 和显式附件；默认只读，需要写入时由策略授权。
- 网络访问默认关闭或采用域名/目的地 allow-list。
- API Key、CLI 凭据和用户 HOME 不进入执行环境；通过受控 IPC / Capability Broker 提供有限能力。
- 限制 CPU、内存、进程数、磁盘空间、执行时间和输出大小，并保留取消/销毁机制。

这里不是建议把 Firecracker 随便嵌入 Electron，而是先定义统一的 Runtime Capability 和 threat model，再做 macOS/Windows 各自可靠的隔离后端。

### P1 — Project 级工作上下文

当前 Workspace 是目录，Task 是独立 Session，Expert 是附加在 Task 上的工作模式。它们还没有组成一个持续的 Project：

- 没有 Project 级 Instructions 与文件引用。
- 没有跨 Task 的 Project Memory 和已确认业务知识。
- 没有对 Project 文件做可复用的检索/索引。
- Schedule 可以绑定 Workspace/Expert，但没有独立 Project Context。
- Task 切换会重置 Provider Session，因此 Project 规则需要重新拼装，现有机制不能代表持久项目记忆。

Claude Cowork 的 Project 组织相关任务，并有独立的本地文件、Instructions、Context、Memory 和 Project Scheduled Tasks。建议沿用这个概念，但保持本地数据和当前 Workspace 结构兼容。

**建议：** 引入轻量 Project 配置（名称、目录、Instructions、引用目录/文档、允许的 Tools、可选 Memory 文件），Task 归属于 Project。不要一开始构建复杂知识图谱或全量 RAG；先把项目说明文件、参考资料、Task 历史和用户确认的持久知识关联起来。

### P1 — Artifacts / 输出成果管理

右侧 Results 面板当前是聊天消息筛选，Files 面板主要显示 Workspace 文件列表和文本预览。这不是独立成果管理能力。

Claude Cowork 的 Live Artifacts 是可独立打开的持久 HTML 页面，能够刷新连接数据，并保留版本历史。它不仅仅是在聊天气泡里显示一段 Markdown。

**建议：**

- 将聊天答复与文件型 Deliverables 分开。
- 建立 Artifact Registry：标题、类型、文件路径、来源 Task、更新时间、版本、预览类型。
- 首批支持 Markdown / HTML / CSV / JSON / SVG / PDF / DOCX / XLSX / PPTX 的预览或下载适配。
- 对 HTML / SVG 采用受限预览 WebContents，限制导航、下载和宿主 API。
- 文件写入后自动出现在成果区；更新时显示 diff / 版本，不覆盖后无法追踪。
- 项目 Dashboard、数据表、图表等可以作为持久 Live Artifact，而不是重复写入聊天。

### P1 — MCP / Connector 产品化

项目已有 MCP STDIO 和 HTTP 连接能力，但主要依赖用户手工填写 command/args/env 或 URL/headers。

对比 Claude Desktop 的 Desktop Extensions / Connectors，缺少：

- `.mcpb` 类型的安装包和 Manifest。
- bundled runtime / dependencies，避免用户自行安装 Node/Python 包。
- Connector / Extension Catalog，发现、搜索、查看权限和安装。
- 版本、升级、卸载和兼容性检查。
- OAuth 授权流程及安全凭据存储。
- Tool-level / category-level Always allow、Needs approval、Blocked 设置。
- 统一的 Connector 健康状态和诊断。

**建议：**

- 先实现 MCPB-compatible package importer 和 manifest validator；不必先做公开 Marketplace。
- 本地凭据从配置文件迁移到 macOS Keychain / Windows Credential Manager。
- 将工具权限从“整个 MCP Server 只有 Allow all 才能连接”细化为“可连接但只注册显式允许的工具”；每个工具独立定义 read/write/delete/destructive 类别。
- 对带写入副作用的工具保留人工确认和每次调用 Trace。

### P1 — 计划任务与长任务

当前 Schedule 是本机定时器，应用退出或系统休眠时不会执行。Claude Cowork 的 Scheduled Tasks 在云端运行，不依赖桌面 App 保持打开；但官方文档也明确说它们不能绑定本地电脑文件夹，因此并不等价于本地 Workspace 文件任务。

建议把执行模式分开：

- **Local Schedule：** 访问本机 Workspace，要求桌面 App 和机器可用。
- **Cloud Schedule：** 只访问远程 Connector / Cloud Storage，不允许访问本地 HOME 或本地浏览器。
- 两种模式使用同一 Schedule 任务定义与运行记录合同，但执行环境、文件可达性和权限必须明确。

另外，当前 Agent Request 仍以一个同步 Send 生命周期为中心。对于长时间任务，应该增加持久化阶段、可恢复进度、Checkpoint、用户插入指导（Steering）和恢复策略。

### P2 — Sub-agent / 并行工作

当前 Code Mode 可以并行调用工具，但并不具备可独立观察的子 Agent Run、任务委派、依赖图、合并结果和子任务取消管理。

建议先实现 Workflow / Task DAG：
- 节点输入输出有结构；
- 节点有 Run ID、状态、重试与耗时；
- 并行节点可独立检查；
- 每个子任务继承 Project 和工具权限，不可提高父任务授权；
- 主 Agent 能汇总并解释失败。

这比先把多 Agent 对话做成复杂 UI 更实用。

### P2 — Voice / Desktop Computer Use

当前 AgentPanel 没有麦克风/Dictation 入口；Browser Tools 也只操作嵌入式浏览器，不具备通用桌面截图/点击/键盘交互。

Claude Cowork 已把 Connector、Browser 和 Computer Use 做成递进的能力链，但官方仍把 Computer Use 标注为研究预览，并明确指出它没有应用级 OS Sandbox，需要按应用授权和严格风险控制。因此不建议仅为“功能对齐”而直接开放整个桌面控制。

若将来需要，应该：
- Connector 优先；
- 当前内置浏览器其次；
- 最后才开放受限的 Screen/Computer Use；
- 每个应用独立授权、可设置 Blocklist；
- 金融交易、账号安全和高敏感系统默认禁止；
- 使用显式的动作预览和确认。

## 5. 建议的实施优先级

| 优先级 | 建议事项 | 主要原因 | 验收标准 |
|---|---|---|---|
| P0 | 附件真正解析和传递给模型 | 当前 UI 暗示“已附加”，实际仅发送路径 | 测试 TXT/PDF/DOCX/XLSX/图片；Provider 能引用文件内容，权限和失败状态明确 |
| P0 | Generated Code OS 级 Sandbox | UtilityProcess 不拦截 Node.js 原生 API | 文件、网络、进程、凭据都被 OS/runtime 约束；注入测试不能越权 |
| P1 | Project Context | 把 Workspace、Task、Expert 和参考知识连接起来 | 新 Task 自动加载 Project Instructions / References / Memory；切换 Project 不串数据 |
| P1 | Artifact Registry + Preview | 让 Agent 交付可以检查、继续编辑和下载的结果 | 一个 Task 能产出多文件；有预览、版本和来源 Task |
| P1 | MCP Package / Credentials / Tool Policy | 降低连接门槛并避免整台服务器过度授权 | 可安装包、保存安全凭据、按工具设置权限、查看连接健康状态 |
| P1 | 长任务 Checkpoint + Steering | 让用户能够中途纠正、暂停和恢复 | 进度节点持久化；重启后能恢复或给出可解释的失败状态 |
| P2 | Workflow DAG / Sub-agent | 处理多步骤并行工作 | 子任务有独立 Trace、依赖关系、取消和结果汇总 |
| P2 | Cloud Schedule / Dispatch | 远程派发和离线执行 | 与 Local Workspace 隔离的云端任务模式，不绕过本地安全边界 |
| P3 | Voice / Computer Use | 更自然的输入和跨应用自动化 | 明确权限、应用授权、动作确认和审计 |

## 6. 不建议为了 Claude Parity 直接照搬的部分

- 不要把 Cloud Schedule 和本地 Workspace 任务混在一起。两种执行模式的文件、凭据和网络边界不同。
- 不要先实现跨设备/团队云同步；项目目前定位为本地单用户工作台，这会显著扩大服务端、安全和运维范围。
- 不要直接在 UtilityProcess 里执行生成代码并宣称安全；先做 OS 级隔离。
- 不要为了 UI 像 Cowork 而堆叠项目记忆、子 Agent、Skills、插件、MCP 的多个同义概念。先定义 Project、Task、Run、Artifact 四个清晰的核心对象。
- 不要把 Expert 的身份 Prompt 当成工作方法。持续业务上下文应该放在 Project Instructions / Memory / Skills / Sources，Expert 保持为可复用执行配置。

## 7. 当前 Session Explorer 重设计

本轮实现的设计变化：

- 将 Session 列表从“重复显示文件夹名”改成 Task Title、Workspace、Expert、最近消息预览和更新时间。
- 将事件分成两种：真正的 Agent Execution Run，以及 Task / Session 等系统 Activity。
- 只有 `turn.started` / `schedule.started` 或具有真实 Provider/Tool 执行证据的历史 Trace 才进入 Trajectory。
- 移除没有意义的空时间条；执行记录使用可展开的 Run Card，显示用户请求、状态、时间、模型/工具统计，步骤和原始输入输出可按需展开。
- Context Explorer 单独展示模型上下文；会话消息和系统活动事件单独查看。
- 大量流式 delta/reasoning 事件默认折叠到高级事件视图，避免淹没有意义的执行记录。

## 8. Claude 官方参考资料

以下均为 Anthropic / Claude 官方资料，访问日期 2026-11-21：

- [Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork) — 本地文件、并行子任务、输出成果、长任务 Steering。
- [Organize your tasks with projects in Claude Cowork](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork) — Project Instructions、Context、Memory、项目 Schedule。
- [Schedule recurring tasks in Claude Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork) — 云端 Schedule、独立运行 Session，以及不能绑定本地文件夹的限制。
- [Assign tasks from anywhere in Claude Cowork](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork) — Dispatch、跨设备持续会话和任务结果通知。
- [Claude Cowork architecture overview](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview) — 云端/本地执行架构、VM 和组织管理边界。
- [Use Claude Cowork safely](https://support.claude.com/en/articles/13364135-use-claude-cowork-safely) — 本地文件范围、风险和用户责任。
- [Use live artifacts in Claude Cowork](https://support.claude.com/en/articles/14729249-use-live-artifacts-in-claude-cowork) — 持久 HTML Artifacts、数据刷新和版本历史。
- [Desktop Extensions: One-click MCP installs](https://www.anthropic.com/research/desktop-extensions) — `.mcpb` 包格式、本地依赖、安装和扩展目录。
- [Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) — Connector Directory、服务权限继承和按工具粒度授权。
- [Collaborate with Claude on Projects](https://www.anthropic.com/news/projects) — Claude.ai Projects 与项目知识、协作/Artifacts 的历史设计背景；它不是 Claude Desktop Cowork Project 的唯一依据。
