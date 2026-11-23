# 架构审查整改 Action Plan

**基线：** `main` / `edca36a2cc92cda7c8c16eb2a6dfb533031e42f9`  
**更新日期：** 2026-11-22  
**范围：** 安全权限、状态协调、布局几何、进程与任务生命周期  
**完成规则：** 代码和对应回归测试完成后勾选；需要真实 Provider、GUI 或跨平台环境才能证明的事项不得只凭静态检查标记为完成。

## Phase 1 — 权限与边界

- [x] **P1-01 Provider 原生文件工具收口。** 受限权限/Expert 不把 `workspace_read_file` 映射成 CodeBuddy 内置 `Read/Glob/Grep`，而是通过应用 Workspace Host Handler 提供文件能力；`assisted` 不开放 Provider 原生文件工具。用户权限与 Expert allowlist 取交集：`none` 不开放任何 Host 工具，Goal Context 读写操作不得绕过 Expert 授权，`workspace_write_file` 在 Workspace 与 Allow all 下开放；高权限 Browser 工具仅在 Allow all 下开放。CodeBuddy 原生文件/Shell/Skill/LSP 工具在受限 Expert 下全部禁用。增加原生工具与 Host 工具权限矩阵回归测试。
- [x] **P1-11 Workspace 范围内自主文件操作（第一阶段）。** 新增 workspace 权限档位：在当前 Task 选定的 Workspace 内自动开放 Host-mediated list/read/search/write，不再要求切换到 Allow all。权限仍与 Expert 上限和工具 allowlist 取交集；CodeBuddy 原生 Shell/文件工具、MCP、插件可执行组件、execute_code、浏览器 JS/CSS/CDP 仍只在原有更高权限条件下开放。文件操作继续经过 Workspace Host 的相对路径、根目录、符号链接、文件描述符身份和大小限制。默认权限仍为 No tools，用户必须显式选择 Workspace。
- [x] **P1-12 Provider 产品边界。** 正式公开构建仅支持 Copilot SDK；CodeBuddy 仅作为开发者本机验证 Provider，必须同时满足未打包运行和 .env 中 ARCHITECT_AGENT_DEV_MODE=true。默认缺省为 Copilot-only；打包构建无条件禁用 CodeBuddy。设置 UI、IPC、Provider configure/inspect/send 均执行同一能力门禁；CodeBuddy 不作为正式 Provider 支持承诺。
- [ ] **P2-11 持久化细粒度 Grant 与命令执行沙箱。** 当前 Workspace 档位是持久化的全局模式，但每次执行的文件能力只绑定当前 Task 的 Workspace；尚未实现按 Workspace 路径保存独立 Grant、逐次 Ask/Allow/Deny 规则或命令执行。只有在 macOS / Windows 都有可验证的 OS-level Sandbox Backend，并覆盖文件、网络、凭据和子进程边界后，才评估自动开放 Shell。UtilityProcess、Tool Broker 和 Prompt 均不能替代该隔离。
- [x] **P1-02 插件指纹扫描有界化。** 在读取文件之前检查单文件 2 MB、总量 20 MB、文件数量和目录深度；打开文件后重新核对文件类型和大小。增加超大文件回归测试。
- [x] **P2-01 插件组件授权拆分（第一阶段）。** 插件启用状态控制 Markdown 指令资源；独立运行授权只允许真实存在 Hooks/MCP/LSP/脚本/Mods 等可执行组件的插件。纯 Markdown 插件不能通过运行授权 IPC，也不会进入 Provider 原生插件目录；最后一个可执行组件被删除后，注册表会持久撤销旧运行授权。UI、注册表和回归测试已同步更新。
  - Copilot SDK：通过 `RuntimeConnection.forStdio` 逐个传递 `--plugin-dir`，并启用 `COPILOT_PLUGIN_DIR_ONLY=true`；CodeBuddy：通过 `CODEBUDDY_PLUGIN_DIRS` 传入目录，使用 `path.delimiter` 兼容 Windows 盘符。两者都只接收权限闸门批准并经指纹校验的临时快照。新增 Provider 入口构造单测，覆盖多插件、清理继承环境和空授权列表。
- [x] **P2-02 归并到 P2-07。** 插件目录指纹、Capability 探测和导入校验与 Main 同步 I/O 治理统一跟踪，避免重复 Action；性能测量和异步化仍未完成，见 P2-07。

## Phase 2 — Agent 状态与运行上下文

- [x] **P1-03 统一 Main 操作冲突判断。** 使用共享忙碌判断覆盖 Schedule、Agent 请求、Task 切换、维护和 Provider busy；Memory 写操作不再只检查 Provider busy；Embedding 检查/重建在异步 I/O 前取得维护占用，并在 `finally` 释放。为冲突判断增加独立单元测试。
- [x] **P1-04 AgentPanel 事件初始化竞态。** 在加载 Session 前订阅事件；加载期间暂存事件，恢复 Transcript 后按序回放；按 Task ID 严格过滤，未就绪时禁止提交。
- [x] **P1-05 Pure Agent Snapshot 竞态。** 实时更新先到时，迟到的初始 Snapshot 不得覆盖新状态。
- [x] **P1-06 Run 浏览器 Tab 固定。** 普通 Agent 请求和 A2UI 交互请求均在 IPC 入口同步捕获 Browser Tab ID，早于异步 Task activation；请求开始时没有 Active Tab 时保留 `null`，不得绑定等待期间新建的 Tab。工具不随 UI 全局 Active Tab 漂移；应用侧阻止在 Run 期间关闭、导航、后退、前进、刷新或停止 Run 目标 Tab，并保护键盘快捷键路径。为目标解析与操作阻断增加单元测试。
- [ ] **P2-03 Browser Session 隔离（自动化跨平台已验证，仍待 GUI 验收）。** 已为每个 Schedule 建立独立、持久的 Electron Session partition；后台 Run 使用隐藏 BrowserWindow / WebContentsView，Browser Tools 通过 Schedule Context 路由，不再引用用户的 Active Tab；可打开专属 Profile 完成人工登录、配置起始 URL，并单独重置 Cookie / 站点存储 / HTTP Cache / HTTP Authentication Cache；Session 下载自动保存到 Downloads 下按 Schedule 哈希隔离的目录，文件名净化并附加唯一下载 ID，不弹出原生 Save 对话框；下载事件关联 Schedule ID 和保存路径；Memory Dreaming 明确不绑定任何可见 Browser Tab。Schedule 删除时会清除对应 Profile 的站点数据；Run finally 强制销毁隐藏窗口以绕过远程页面的 beforeunload 阻塞。应用退出时也会显式销毁所有已登记的 Run Context（包括仍在初始化、尚未挂到活动变量的 Context）、Profile 根窗口及 OAuth 子窗口，取消未完成下载并 flush 已初始化的 Session；退出开始后禁止新建 Session、BrowserWindow、Tab 和 OAuth 子窗口。等待中的 Session 初始化有 1.5 秒上限，不会无限阻塞退出。后台 WebContents 禁用背景节流。新增了部分初始化失败时的 context 回滚、Tab WebContents 先登记后挂载和容错式全量清理，避免准备阶段失败留下隐藏窗口。另新增真实 Electron `persist:` Session 多进程测试，覆盖重启后 Cookie 持久化、Schedule A/B 与普通浏览器隔离，以及只重置 A 不影响其他 Profile；测试接入 macOS / Windows CI。Schedule 下载处理器已抽为生产/测试共用函数，并新增真实 Electron BrowserWindow + 本地 HTTP 下载 E2E，验证按 Profile 目录落盘、文件名净化、下载事件、完成回收和无 Save 对话框。GUI 验收仍需覆盖实际站点登录态复用、OAuth/SSO Popup、Schedule 后台 Run 可视化与完整应用退出清理，完成前本项保持未完成。实际下载保存路径、文件内容与下载状态已由生产处理器的真实 Electron 集成测试验证。
- [x] **P2-04 当前阶段不实施完整操作状态机（范围决策已关闭）。** 保留共享忙碌判断和 maintenance lock；只对发现真实竞态的生命周期补局部状态与测试。没有证据证明当前布尔状态协调需要被全量替换，本项不作为当前实施任务。此勾选仅表示决策关闭，不表示完整状态机已实现。

## Phase 3 — Layout 唯一事实来源

- [x] **P1-07 Renderer 拥有实际布局几何。** Sidepanel/Pure Agent 均测量 Browser 内容矩形，并通过统一 IPC 发送完整 `x/y/width/height`。
- [x] **P1-08 删除 Main 的重复布局计算。** Main 只校验、裁剪并应用 Renderer 提供的矩形，不再从 WorkspaceDocument 重新计算 Native Browser View 位置；保留独立 Layout Engine 供布局树计算使用。
- [x] **P2-05 Layout 状态单一事实来源。** WorkspaceDocument v2 统一保存分栏比例、可见性、停靠方向/顺序、Tab Group 和浮动面板；移除 WorkspaceLayoutState 类型、独立 IPC/event 和 Renderer 持久化状态。旧 workspace-layout.json 只在没有有效 v2 文档时读取一次并迁移；Renderer 像素宽度由树比例与当前视口派生。新增四方向停靠、比例保持、隐藏状态迁移和 JSON 往返测试。
- [x] **P2-06 布局验证规则统一。** 基础树语义统一由 `validateLayout` 校验（ID、split 轴向、比例、splitterSize 和 panel 尺寸）；Document parser 仅保留不可信输入的结构、节点数及深度防护；`validateTree` 复用共享校验。移除未被计算器消费的 `LayoutOptions.minPanelSize`，并补充布局回归测试。

## Phase 4 — 进程、性能和资源回收

- [x] **P2-07 Main 同步 I/O 治理。** Workspace 文件列表、读取、写入与搜索，以及插件目录指纹、Capability 探测、插件验证/导入/导出/授权、运行时快照、Copilot 插件投影、Agent Skill 扫描/导入/启停/指令读取和 ZIP 解压落盘均使用异步文件 API；Main IPC 与 Copilot 调用链等待操作完成。指纹读取保留 `O_NOFOLLOW`、文件描述符身份/大小复核和文件数量/目录深度上限；每目录最多 8 路并发读取，最终 SHA-256 仍按排序后的深度优先顺序更新。ZIP CRC32 改为查表实现，保留原校验语义；解压仍使用受大小上限约束的 Node zlib。

  **性能验收：** 历史 GitHub Actions Benchmark run [44998687395](https://github.com/saga/architect-agent-desktop/actions/runs/44998687395) 使用临时 Linux runner / Node.js 24.22.3，仅作为当时的性能数据采样环境，不代表产品支持平台或当前 CI 目标。后续 benchmark workflow 已改为 macOS runner。相同 run 对同一组 8 MiB 插件目录（259 个文件）和 8 MiB 未压缩 Skill ZIP（5 个文件），同步基线 `7dfd411` 对比当前异步实现：插件导入 34.76 → 110.45 ms；运行授权/指纹 31.42 → 96.64 ms；重复扫描 126.56 → 340.31 ms；Skill ZIP 导入 326.53 → 42.05 ms；组合总耗时 520.67 → 591.33 ms（增加 13.6%）。最大定时器延迟 520.17 → 21.11 ms（下降约 96%）。异步 I/O 牺牲少量整体 wall-clock 时间，换得 Main Event Loop 不再被目录扫描/文件复制长时间阻塞；CRC 查表消除了 ZIP 校验的主要 CPU 热点。没有证据支持再引入 Worker/UtilityProcess，因此不增加新的进程层。

  **验证：** Build run [44998687413](https://github.com/saga/architect-agent-desktop/actions/runs/44998687413) 的 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均通过。
- [x] **P2-08 UtilityProcess 子进程树清理。** POSIX 使用冻结根进程、重复发现后代、冻结新后代、叶节点优先终止并等待退出；Windows 使用 `taskkill /T /F`。Runtime 正常完成、失败、超时、取消和 `dispose()` 均调用进程树清理；无论 PID 是否已就绪，都会调用 Electron `UtilityProcess.kill()` 兜底关闭根进程。新增真实 Node 父/子/孙进程树集成测试，以及真实 Electron UtilityProcess 生命周期集成测试：UtilityProcess 内派生 Node 子进程，分别验证取消、超时和 `dispose()` 会结束整棵进程树。修正 Main 侧 `UtilityProcess` 消息解析，按 Electron API 接收直接 payload，恢复真实 Tool Broker 消息流。Build run [45005886227](https://github.com/saga/architect-agent-desktop/actions/runs/45005886227) 的 macOS 与 Windows jobs 均通过上述真实进程树、真实 Electron Runtime、TypeScript、Vitest、应用构建和原生安装包构建。完整 Agent Code Mode GUI / Provider 人工验收仍单独保留，不将自动化 Runtime 测试冒充 GUI 验收。
- [x] **P2-09 CodeBuddy 总预算。** 一次用户请求最多 12 个模型轮次（6 次 Query、每次最多 2 轮）；应用 Host 工具与兼容模式文本工具调用共用 80 次请求级预算；兼容模式工具结果总输出最多 256 KiB；仍受现有 5 分钟请求超时约束。Provider 内部原生工具由 SDK 权限和轮次限制约束，不声称由应用计数器逐个计数。
- [x] **P2-10 未使用 Runtime 入口清理。** 确认 `executeSkill()` / `SkillExecutionRequest` / Worker 的 `execute` 分支没有产品调用点；按 Agent Skills“脚本不会由导入器执行”的产品边界移除死入口，保留 Code Mode 使用的 UtilityProcess。同步修订 Runtime 和 Agent Skills 文档。

## 验证清单

- [x] Main 插件/Skill 异步 I/O 回归测试及性能基准（同步/异步同规模对比已记录）

- [x] TypeScript typecheck
- [x] 全部 Vitest 单元测试
- [x] Layout Engine 独立测试
- [x] Markdown-only Plugin 不能获得或保留可执行运行时授权（Vitest 回归测试已加入）
- [x] Schedule Browser Profile partition ID 稳定且按 Schedule 隔离（Vitest 回归测试已加入）
- [x] 真实 Electron `persist:` Session 多进程回归：跨进程重启持久化、Schedule A/B 与普通浏览器 Cookie 隔离、重置 A 不影响 B 和普通浏览器（Build runs [45002307524](https://github.com/saga/architect-agent-desktop/actions/runs/45002307524) 与 [45003096172](https://github.com/saga/architect-agent-desktop/actions/runs/45003096172) 的 macOS / Windows job 均通过）
- [x] Schedule Browser Tool Context 不会回退到用户 Active Tab（Vitest 回归测试已加入）
- [x] Schedule Browser Context 部分初始化失败会执行资源回滚，且清理失败不覆盖原始错误（Vitest 回归测试已加入）
- [x] Schedule Profile 重置会依次清除站点存储、HTTP Cache、HTTP Authentication Cache，并在完成后 flush（Vitest 回归测试已加入）
- [x] Schedule 下载路径按 Profile 隔离、远端文件名净化、唯一命名且不触发 Save 对话框（Vitest 路径测试已加入）
- [x] 真实 Electron Schedule 下载回归：使用生产 `registerScheduleBrowserDownloadHandler`，在独立 BrowserWindow 中从本地 HTTP 服务下载，验证 Profile 专属保存目录、远端文件名净化、文件内容、started/completed 事件和活动下载回收（Build run [45007115270](https://github.com/saga/architect-agent-desktop/actions/runs/45007115270)，macOS / Windows 均通过）
- [x] Schedule Profile 重置会关闭根登录窗口和所有嵌套 OAuth 子窗口，取消未完成下载但保留已完成文件；Storage/Cache/Auth Cache 清理即使单步失败也会继续执行并 flush（Vitest 回归测试已加入）
- [x] 真实 Node 父/子/孙进程树在 macOS、Windows CI 中均被终止（GitHub Actions Build run 44999451094）
- [x] CodeBuddy 原生工具与 Host 工具权限矩阵单元测试：受限 Expert 下禁用原生 Read/Write/Edit/Glob/Grep/Bash 等工具；`none` 模式不开放 Host 工具；Goal Context 不绕过 Expert allowlist。
- [ ] CodeBuddy 真实运行验证：Expert 只授权 Workspace read 时，不能读取 Workspace 外文件
- [x] Agent 请求在 IPC 入口、Task activation 前同步固定 Browser Tab ID；初始无 Tab 时保持 null，防止异步切换/新建 Tab 造成目标漂移（普通请求与 A2UI 交互均已修复，现有 resolver 回归测试覆盖 pin/null 语义）。
- [ ] Copilot / CodeBuddy 各自的 Agent Run 期间切换 Tab 验证
- [ ] Sidepanel：左右/上下停靠、隐藏、窗口缩放、Tab Group 切换、浮动/重新停靠
- [ ] Pure Agent：右侧 Browser 显示/隐藏、切换 Files/Results、窗口缩放
- [x] WorkspaceDocument v1 偏好迁移、四方向停靠、显隐和面板比例的 v2 往返回归测试（Layout Engine 自动化测试已覆盖）
- [ ] macOS：Electron Agent Code Mode 中真实 UtilityProcess 取消、超时及应用退出清理验证
- [x] 真实 Electron UtilityProcess Runtime 进程树集成测试：在独立 Electron 主进程内实际 fork UtilityProcess，并从 Worker 派生 Node 子进程；分别验证 AbortSignal 取消、时间预算超时与 Runtime `dispose()` 会终止 Worker 和派生进程。macOS / Windows 均已通过 Build run [45005886227](https://github.com/saga/architect-agent-desktop/actions/runs/45005886227)。
- [ ] Windows：Electron Agent Code Mode 中真实 UtilityProcess 取消、超时及应用退出清理验证
- [x] macOS ARM64 DMG / ZIP 与 Windows x64 NSIS 构建及 CI artifact 检查（run [45003096172](https://github.com/saga/architect-agent-desktop/actions/runs/45003096172) 两平台均成功；artifact 仅包含安装文件，约 830 MB / 328 MB。当前产物未签名，macOS 未公证）

## CI 更新记录

- 2026-11-22：Build run [45007115270](https://github.com/saga/architect-agent-desktop/actions/runs/45007115270) 对应提交 `45b9bdc`，macOS / Windows 两个目标平台全部成功。覆盖 `npm ci`、TypeScript、全部 Vitest、应用构建、Layout Engine、真实 Electron Schedule Session 持久化/隔离/重置与生产下载处理器 E2E、真实 Electron UtilityProcess Worker + 后代进程取消/超时/`dispose()` 清理，以及 macOS ARM64 DMG/ZIP、Windows x64 NSIS 构建和 artifact 上传。产物约 792 MiB / 313 MiB；未配置代码签名或 Apple 公证。

- 2026-11-22：Build run [45005886227](https://github.com/saga/architect-agent-desktop/actions/runs/45005886227) 在 macOS / Windows 两个平台全部成功。除了 TypeScript、完整 Vitest、Layout 和 Schedule Session 持久化/隔离测试外，新增真实 Electron UtilityProcess 生命周期测试：实际 Worker 派生 Node 子进程，取消、超时、`dispose()` 三种路径都确认根 Worker 与派生进程 PID 退出。macOS ARM64 DMG/ZIP 与 Windows x64 NSIS 安装包均生成并上传；Artifact 仅保留安装文件。安装包未签名，macOS 未公证。

- 2026-11-22：提交 `e503c86` 的 Build run [45003096172](https://github.com/saga/architect-agent-desktop/actions/runs/45003096172) 在 macOS / Windows 两个目标 runner 均成功，包含 TypeScript、全部 Vitest、应用 build、Layout Engine、真实 Electron Session 多进程测试及原生安装包构建。artifact 规则仅上传 macOS `.dmg` / `*-mac.zip` 与 Windows `.exe`，体积分别约 830 MB / 328 MB；当前未配置平台代码签名或 macOS 公证。后续提交 `c793759` 增加 Schedule Browser 初始化/退出竞态保护，其双平台验证仍在进行。

- 2026-11-22：UtilityProcess 子进程树清理提交 `e860a6b` 的历史 Build run [44999451094](https://github.com/saga/architect-agent-desktop/actions/runs/44999451094) 曾额外运行 Ubuntu job；项目目标平台的 macOS 与 Windows jobs 均通过：`npm ci`、TypeScript typecheck、全部 Vitest（包含真实 Node 父/子/孙进程树集成测试）、应用 build 和 Layout Engine 独立测试均成功。该结果验证当前 OS 的进程树算法和 Runtime 测试接线，但不替代在 Electron GUI 中验证完整 Agent Code Mode 取消、超时和应用退出。

- 2026-11-22：异步插件/Skill I/O 提交 `e0dba71` 的 GitHub Actions Build run [44997636956](https://github.com/saga/architect-agent-desktop/actions/runs/44997636956) 已通过：npm ci、TypeScript typecheck、全部 271 项 Vitest、应用 build 和 Layout Engine 独立测试全部成功。

- 2026-11-22：WorkspaceDocument 单一布局状态提交 `b37101c` 的 GitHub Actions Build run [44996665271](https://github.com/saga/architect-agent-desktop/actions/runs/44996665271) 已通过：`npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均成功。新增布局迁移、四方向停靠、显隐及分栏比例往返测试已纳入 Vitest。

- 2026-11-22：最新 Schedule Browser OAuth / cleanup 修复提交 `71ce796` 的 GitHub Actions Build run [44995645403](https://github.com/saga/architect-agent-desktop/actions/runs/44995645403) 已通过：`npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均成功。此轮包括 Electron 45 popup 类型修正、Profile 子窗口安全策略和 WebContents 生命周期清理。
- 2026-11-22：Schedule Browser Session 主体提交 `0499fed` 的 GitHub Actions Build run [44994616328](https://github.com/saga/architect-agent-desktop/actions/runs/44994616328) 已通过；follow-up 生命周期清理提交 `2e839da` 的 Build run [44994804904](https://github.com/saga/architect-agent-desktop/actions/runs/44994804904) 也已通过。两次 validate 均完成 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试。
- 2026-11-22：最新提交 `64e7e0b` 的 GitHub Actions Build run [44989449265](https://github.com/saga/architect-agent-desktop/actions/runs/44989449265) 已完成且成功。validate job 中 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均通过；本次加入的 Markdown-only Plugin 授权回归测试包含在该 Vitest 结果中。当前工作流仅验证构建，不执行 Windows/macOS 安装包打包，因此不能据此声称安装包已通过跨平台验证。
- 当前 CI 在 macOS runner 构建 ARM64 DMG / ZIP，在 Windows runner 构建 x64 NSIS，并上传安装文件 artifact；CI 仍不替代真实 Provider 和 BrowserWindow / OAuth / 下载 GUI 验收。构建产物未接入代码签名或 Apple 公证。

## 本轮完成定义

P2-01 当前完成的是授权边界第一阶段：插件启用与可执行运行时授权已经分开，纯 Markdown 插件无法获得运行时授权。混合插件在启用且运行时获批后仍由 Provider 原生加载整份插件快照；如未来要对 Skills、Commands、Agents 做逐组件授权，需要进一步收紧快照投影和 Provider Adapter，不能仅增加 UI 开关。

P2-03 仍等待 macOS / Windows BrowserWindow、Session、OAuth Popup、下载和后台 Run 生命周期 GUI 验收。P2-08 的真实 OS 进程树测试已在 macOS、Windows CI 通过，仍等待真实 Electron Agent Code Mode 的取消、超时和应用退出 GUI 验收。P2-05、P2-07 已完成代码、自动化测试与 CI/基准验证；不得把尚未完成的平台验收项标记为 done。

Action 项目勾选表示相关代码与自动化回归测试已经加入；上面的验证清单则需要实际 CI、Provider 或 GUI 环境确认。当前 CI 结果将在 Action Plan 更新记录中记录，不会仅因为提交成功就标记为通过。
