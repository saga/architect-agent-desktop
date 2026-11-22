# 架构审查整改 Action Plan

**基线：** `main` / `edca36a2cc92cda7c8c16eb2a6dfb533031e42f9`  
**更新日期：** 2026-11-22  
**范围：** 安全权限、状态协调、布局几何、进程与任务生命周期  
**完成规则：** 代码和对应回归测试完成后勾选；需要真实 Provider、GUI 或跨平台环境才能证明的事项不得只凭静态检查标记为完成。

## Phase 1 — 权限与边界

- [x] **P1-01 CodeBuddy 文件工具收口。** 受限权限/Expert 不再把 `workspace_read_file` 映射成 CodeBuddy 内置 `Read/Glob/Grep`，而是通过应用 Workspace Host Handler 提供读写；`assisted` 不开放 Provider 原生文件工具。增加工具选择策略单元测试。
- [x] **P1-02 插件指纹扫描有界化。** 在读取文件之前检查单文件 2 MB、总量 20 MB、文件数量和目录深度；打开文件后重新核对文件类型和大小。增加超大文件回归测试。
- [x] **P2-01 插件组件授权拆分（第一阶段）。** 插件启用状态控制 Markdown 指令资源；独立运行授权只允许真实存在 Hooks/MCP/LSP/脚本/Mods 等可执行组件的插件。纯 Markdown 插件不能通过运行授权 IPC，也不会进入 Provider 原生插件目录；最后一个可执行组件被删除后，注册表会持久撤销旧运行授权。UI、注册表和回归测试已同步更新。
- [x] **P2-02 归并到 P2-07。** 插件目录指纹、Capability 探测和导入校验与 Main 同步 I/O 治理统一跟踪，避免重复 Action；性能测量和异步化仍未完成，见 P2-07。

## Phase 2 — Agent 状态与运行上下文

- [x] **P1-03 统一 Main 操作冲突判断。** 使用共享忙碌判断覆盖 Schedule、Agent 请求、Task 切换、维护和 Provider busy；Memory 写操作不再只检查 Provider busy；Embedding 检查/重建在异步 I/O 前取得维护占用，并在 `finally` 释放。为冲突判断增加独立单元测试。
- [x] **P1-04 AgentPanel 事件初始化竞态。** 在加载 Session 前订阅事件；加载期间暂存事件，恢复 Transcript 后按序回放；按 Task ID 严格过滤，未就绪时禁止提交。
- [x] **P1-05 Pure Agent Snapshot 竞态。** 实时更新先到时，迟到的初始 Snapshot 不得覆盖新状态。
- [x] **P1-06 Run 浏览器 Tab 固定。** 每次 Agent Run 固定工具目标 Tab（包括 Run 开始时没有 Active Tab 的情况），工具不再随 UI 的全局 Active Tab 漂移；应用侧阻止在 Run 期间关闭、导航、后退、前进、刷新或停止该 Tab，并保护键盘快捷键路径。为目标解析与操作阻断增加单元测试。
- [ ] **P2-03 Browser Session 隔离（第一阶段代码已实现，待跨平台验收）。** 已为每个 Schedule 建立独立、持久的 Electron Session partition；后台 Run 使用隐藏 BrowserWindow / WebContentsView，Browser Tools 通过 Schedule Context 路由，不再引用用户的 Active Tab；可打开专属 Profile 完成人工登录、配置起始 URL，并单独重置 Cookie / 站点存储 / HTTP Cache / HTTP Authentication Cache；Session 下载自动保存到 Downloads 下按 Schedule 哈希隔离的目录，文件名净化并附加唯一下载 ID，不弹出原生 Save 对话框；下载事件关联 Schedule ID 和保存路径；Memory Dreaming 明确不绑定任何可见 Browser Tab。Schedule 删除时会清除对应 Profile 的站点数据；后台 WebContents 禁用背景节流，Run finally 强制销毁隐藏窗口以绕过远程页面的 beforeunload 阻塞。新增了部分初始化失败时的 context 回滚、Tab WebContents 先登记后挂载和容错式全量清理，避免准备阶段失败留下隐藏窗口。另新增真实 Electron `persist:` Session 多进程测试，覆盖重启后 Cookie 持久化、Schedule A/B 与普通浏览器隔离，以及只重置 A 不影响其他 Profile；测试接入 macOS / Windows CI。仍需 GUI 验证登录态持久化、弹窗、下载保存路径、超时/取消销毁和退出清理后才能标记 done。
- [x] **P2-04 当前阶段不实施完整操作状态机（范围决策已关闭）。** 保留共享忙碌判断和 maintenance lock；只对发现真实竞态的生命周期补局部状态与测试。没有证据证明当前布尔状态协调需要被全量替换，本项不作为当前实施任务。此勾选仅表示决策关闭，不表示完整状态机已实现。

## Phase 3 — Layout 唯一事实来源

- [x] **P1-07 Renderer 拥有实际布局几何。** Sidepanel/Pure Agent 均测量 Browser 内容矩形，并通过统一 IPC 发送完整 `x/y/width/height`。
- [x] **P1-08 删除 Main 的重复布局计算。** Main 只校验、裁剪并应用 Renderer 提供的矩形，不再从 WorkspaceDocument 重新计算 Native Browser View 位置；保留独立 Layout Engine 供布局树计算使用。
- [x] **P2-05 Layout 状态单一事实来源。** WorkspaceDocument v2 统一保存分栏比例、可见性、停靠方向/顺序、Tab Group 和浮动面板；移除 WorkspaceLayoutState 类型、独立 IPC/event 和 Renderer 持久化状态。旧 workspace-layout.json 只在没有有效 v2 文档时读取一次并迁移；Renderer 像素宽度由树比例与当前视口派生。新增四方向停靠、比例保持、隐藏状态迁移和 JSON 往返测试。
- [x] **P2-06 布局验证规则统一。** 基础树语义统一由 `validateLayout` 校验（ID、split 轴向、比例、splitterSize 和 panel 尺寸）；Document parser 仅保留不可信输入的结构、节点数及深度防护；`validateTree` 复用共享校验。移除未被计算器消费的 `LayoutOptions.minPanelSize`，并补充布局回归测试。

## Phase 4 — 进程、性能和资源回收

- [x] **P2-07 Main 同步 I/O 治理。** Workspace 文件列表、读取、写入与搜索，以及插件目录指纹、Capability 探测、插件验证/导入/导出/授权、运行时快照、Copilot 插件投影、Agent Skill 扫描/导入/启停/指令读取和 ZIP 解压落盘均使用异步文件 API；Main IPC 与 Copilot 调用链等待操作完成。指纹读取保留 `O_NOFOLLOW`、文件描述符身份/大小复核和文件数量/目录深度上限；每目录最多 8 路并发读取，最终 SHA-256 仍按排序后的深度优先顺序更新。ZIP CRC32 改为查表实现，保留原校验语义；解压仍使用受大小上限约束的 Node zlib。

  **性能验收：** GitHub Actions Benchmark run [44998687395](https://github.com/saga/architect-agent-desktop/actions/runs/44998687395)，Linux / Node.js 24.22.3，同一组 8 MiB 插件目录（259 个文件）和 8 MiB 未压缩 Skill ZIP（5 个文件），同步基线 `7dfd411` 对比当前异步实现：插件导入 34.76 → 110.45 ms；运行授权/指纹 31.42 → 96.64 ms；重复扫描 126.56 → 340.31 ms；Skill ZIP 导入 326.53 → 42.05 ms；组合总耗时 520.67 → 591.33 ms（增加 13.6%）。最大定时器延迟 520.17 → 21.11 ms（下降约 96%）。异步 I/O 牺牲少量整体 wall-clock 时间，换得 Main Event Loop 不再被目录扫描/文件复制长时间阻塞；CRC 查表消除了 ZIP 校验的主要 CPU 热点。没有证据支持再引入 Worker/UtilityProcess，因此不增加新的进程层。

  **验证：** Build run [44998687413](https://github.com/saga/architect-agent-desktop/actions/runs/44998687413) 的 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均通过。
- [x] **P2-08 UtilityProcess 子进程树清理。** POSIX 使用冻结根进程、重复发现后代、冻结新后代、叶节点优先终止并等待退出；Windows 使用 `taskkill /T /F`。Runtime 正常完成、失败、超时、取消和 `dispose()` 均调用进程树清理；无论 PID 是否已就绪，都会调用 Electron `UtilityProcess.kill()` 兜底关闭根进程。新增真实 Node 父/子/孙进程树集成测试，在 macOS 和 Windows runner 上执行真实 OS 清理路径；Runtime 单元测试覆盖正常结束、PID 未就绪时取消和超时。最新三平台 Build run [44999748352](https://github.com/saga/architect-agent-desktop/actions/runs/44999748352) 全部成功。完整 Electron GUI Agent Code Mode 的打包运行/取消/退出人工验收仍单独保留，不影响进程树清理代码项关闭。
- [x] **P2-09 CodeBuddy 总预算。** 一次用户请求最多 12 个模型轮次（6 次 Query、每次最多 2 轮）；应用 Host 工具与兼容模式文本工具调用共用 80 次请求级预算；兼容模式工具结果总输出最多 256 KiB；仍受现有 5 分钟请求超时约束。Provider 内部原生工具由 SDK 权限和轮次限制约束，不声称由应用计数器逐个计数。
- [x] **P2-10 未使用 Runtime 入口清理。** 确认 `executeSkill()` / `SkillExecutionRequest` / Worker 的 `execute` 分支没有产品调用点；按 Agent Skills“脚本不会由导入器执行”的产品边界移除死入口，保留 Code Mode 使用的 UtilityProcess。同步修订 Runtime 和 Agent Skills 文档。

## 验证清单

- [x] Main 插件/Skill 异步 I/O 回归测试及性能基准（同步/异步同规模对比已记录）

- [x] TypeScript typecheck
- [x] 全部 Vitest 单元测试
- [x] Layout Engine 独立测试
- [x] Markdown-only Plugin 不能获得或保留可执行运行时授权（Vitest 回归测试已加入）
- [x] Schedule Browser Profile partition ID 稳定且按 Schedule 隔离（Vitest 回归测试已加入）
- [ ] 真实 Electron `persist:` Session 多进程回归：跨进程重启持久化、Schedule A/B 与普通浏览器 Cookie 隔离、重置 A 不影响 B 和普通浏览器（本次新增，等待 macOS / Windows CI 验证）
- [x] Schedule Browser Tool Context 不会回退到用户 Active Tab（Vitest 回归测试已加入）
- [x] Schedule Browser Context 部分初始化失败会执行资源回滚，且清理失败不覆盖原始错误（Vitest 回归测试已加入）
- [x] Schedule Profile 重置会依次清除站点存储、HTTP Cache、HTTP Authentication Cache，并在完成后 flush（Vitest 回归测试已加入）
- [x] Schedule 下载路径按 Profile 隔离、远端文件名净化、唯一命名且不触发 Save 对话框（Vitest 路径测试已加入）
- [x] Schedule Profile 重置会关闭根登录窗口和所有嵌套 OAuth 子窗口，取消未完成下载但保留已完成文件；Storage/Cache/Auth Cache 清理即使单步失败也会继续执行并 flush（Vitest 回归测试已加入）
- [x] 真实 Node 父/子/孙进程树在 macOS、Windows CI 中均被终止（GitHub Actions Build run 44999451094）
- [ ] CodeBuddy 真实运行验证：Expert 只授权 Workspace read 时，不能读取 Workspace 外文件
- [ ] Copilot / CodeBuddy 各自的 Agent Run 期间切换 Tab 验证
- [ ] Sidepanel：左右/上下停靠、隐藏、窗口缩放、Tab Group 切换、浮动/重新停靠
- [ ] Pure Agent：右侧 Browser 显示/隐藏、切换 Files/Results、窗口缩放
- [x] WorkspaceDocument v1 偏好迁移、四方向停靠、显隐和面板比例的 v2 往返回归测试（Layout Engine 自动化测试已覆盖）
- [ ] macOS：Electron Agent Code Mode 中真实 UtilityProcess 取消、超时及应用退出清理验证
- [ ] Windows：Electron Agent Code Mode 中真实 UtilityProcess 取消、超时及应用退出清理验证
- [ ] macOS DMG / ZIP 与 Windows NSIS 安装包构建验证及 CI 产物检查（本次新增打包步骤，等待 CI 运行）

## CI 更新记录

- 2026-11-22：UtilityProcess 子进程树清理提交 `e860a6b` 的历史 Build run [44999451094](https://github.com/saga/architect-agent-desktop/actions/runs/44999451094) 曾额外运行 Ubuntu job；项目目标平台的 macOS 与 Windows jobs 均通过：`npm ci`、TypeScript typecheck、全部 Vitest（包含真实 Node 父/子/孙进程树集成测试）、应用 build 和 Layout Engine 独立测试均成功。该结果验证当前 OS 的进程树算法和 Runtime 测试接线，但不替代在 Electron GUI 中验证完整 Agent Code Mode 取消、超时和应用退出。

- 2026-11-22：异步插件/Skill I/O 提交 `e0dba71` 的 GitHub Actions Build run [44997636956](https://github.com/saga/architect-agent-desktop/actions/runs/44997636956) 已通过：npm ci、TypeScript typecheck、全部 271 项 Vitest、应用 build 和 Layout Engine 独立测试全部成功。

- 2026-11-22：WorkspaceDocument 单一布局状态提交 `b37101c` 的 GitHub Actions Build run [44996665271](https://github.com/saga/architect-agent-desktop/actions/runs/44996665271) 已通过：`npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均成功。新增布局迁移、四方向停靠、显隐及分栏比例往返测试已纳入 Vitest。

- 2026-11-22：最新 Schedule Browser OAuth / cleanup 修复提交 `71ce796` 的 GitHub Actions Build run [44995645403](https://github.com/saga/architect-agent-desktop/actions/runs/44995645403) 已通过：`npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均成功。此轮包括 Electron 45 popup 类型修正、Profile 子窗口安全策略和 WebContents 生命周期清理。
- 2026-11-22：Schedule Browser Session 主体提交 `0499fed` 的 GitHub Actions Build run [44994616328](https://github.com/saga/architect-agent-desktop/actions/runs/44994616328) 已通过；follow-up 生命周期清理提交 `2e839da` 的 Build run [44994804904](https://github.com/saga/architect-agent-desktop/actions/runs/44994804904) 也已通过。两次 validate 均完成 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试。
- 2026-11-22：最新提交 `64e7e0b` 的 GitHub Actions Build run [44989449265](https://github.com/saga/architect-agent-desktop/actions/runs/44989449265) 已完成且成功。validate job 中 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均通过；本次加入的 Markdown-only Plugin 授权回归测试包含在该 Vitest 结果中。当前工作流仅验证构建，不执行 Windows/macOS 安装包打包，因此不能据此声称安装包已通过跨平台验证。
- 当前 CI 仅验证构建，不执行 Windows/macOS 安装包打包，也不替代真实 Electron BrowserWindow / Session 的 GUI 验收。

## 本轮完成定义

P2-01 当前完成的是授权边界第一阶段：插件启用与可执行运行时授权已经分开，纯 Markdown 插件无法获得运行时授权。混合插件在启用且运行时获批后仍由 Provider 原生加载整份插件快照；如未来要对 Skills、Commands、Agents 做逐组件授权，需要进一步收紧快照投影和 Provider Adapter，不能仅增加 UI 开关。

P2-03 仍等待 macOS / Windows BrowserWindow、Session、OAuth Popup、下载和后台 Run 生命周期 GUI 验收。P2-08 的真实 OS 进程树测试已在 macOS、Windows CI 通过，仍等待真实 Electron Agent Code Mode 的取消、超时和应用退出 GUI 验收。P2-05、P2-07 已完成代码、自动化测试与 CI/基准验证；不得把尚未完成的平台验收项标记为 done。

Action 项目勾选表示相关代码与自动化回归测试已经加入；上面的验证清单则需要实际 CI、Provider 或 GUI 环境确认。当前 CI 结果将在 Action Plan 更新记录中记录，不会仅因为提交成功就标记为通过。
