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
- [ ] **P2-03 Browser Session 隔离（第一阶段代码已实现，待跨平台验收）。** 已为每个 Schedule 建立独立、持久的 Electron Session partition；后台 Run 使用隐藏 BrowserWindow / WebContentsView，Browser Tools 通过 Schedule Context 路由，不再引用用户的 Active Tab；可打开专属 Profile 完成人工登录、配置起始 URL，并单独重置 Cookie / 站点存储 / Cache；Session 下载事件关联 Schedule ID；Memory Dreaming 明确不绑定任何可见 Browser Tab。Schedule 删除时会清除对应 Profile 的站点数据；后台 WebContents 禁用背景节流，Run finally 强制销毁隐藏窗口以绕过远程页面的 beforeunload 阻塞。仍需 macOS / Windows GUI 验证登录态持久化、弹窗、下载保存路径、超时/取消销毁和退出清理后才能标记 done。
- [x] **P2-04 当前阶段不实施完整操作状态机（范围决策已关闭）。** 保留共享忙碌判断和 maintenance lock；只对发现真实竞态的生命周期补局部状态与测试。没有证据证明当前布尔状态协调需要被全量替换，本项不作为当前实施任务。此勾选仅表示决策关闭，不表示完整状态机已实现。

## Phase 3 — Layout 唯一事实来源

- [x] **P1-07 Renderer 拥有实际布局几何。** Sidepanel/Pure Agent 均测量 Browser 内容矩形，并通过统一 IPC 发送完整 `x/y/width/height`。
- [x] **P1-08 删除 Main 的重复布局计算。** Main 只校验、裁剪并应用 Renderer 提供的矩形，不再从 WorkspaceDocument 重新计算 Native Browser View 位置；保留独立 Layout Engine 供布局树计算使用。
- [x] **P2-05 Layout 状态单一事实来源。** WorkspaceDocument v2 统一保存分栏比例、可见性、停靠方向/顺序、Tab Group 和浮动面板；移除 WorkspaceLayoutState 类型、独立 IPC/event 和 Renderer 持久化状态。旧 workspace-layout.json 只在没有有效 v2 文档时读取一次并迁移；Renderer 像素宽度由树比例与当前视口派生。新增四方向停靠、比例保持、隐藏状态迁移和 JSON 往返测试。
- [x] **P2-06 布局验证规则统一。** 基础树语义统一由 `validateLayout` 校验（ID、split 轴向、比例、splitterSize 和 panel 尺寸）；Document parser 仅保留不可信输入的结构、节点数及深度防护；`validateTree` 复用共享校验。移除未被计算器消费的 `LayoutOptions.minPanelSize`，并补充布局回归测试。

## Phase 4 — 进程、性能和资源回收

- [ ] **P2-07 Main 同步 I/O 治理（异步 I/O 第一阶段已实现，待 CI 与基准验证）。** Workspace 文件列表、读取、写入与搜索已使用异步文件 API，并保持文件描述符、符号链接和路径边界校验；本阶段进一步将插件目录指纹、Capability 探测、插件验证/导入/导出/授权、运行时快照、Copilot 插件投影，以及 Agent Skill 目录扫描/导入/启停/指令读取和 ZIP 解压落盘改为 `fs/promises`，Main IPC 与 Copilot 调用链均等待完成。指纹读取仍保留 `O_NOFOLLOW`、文件描述符身份/大小复核和文件数量/目录深度上限。ZIP CRC 与 `inflateRawSync` 是有 20 MB 上限的 CPU 解压，不属于文件 I/O；是否移至 UtilityProcess 由代表性 Event Loop 延迟/导入耗时基准决定。仍需先通过本次 CI，并补齐改造前后可比较的 Main Event Loop 延迟和导入耗时测量；没有测量证据不新增 Worker/UtilityProcess。
- [ ] **P2-08 UtilityProcess 子进程树清理（实现与自动化测试已加入，待平台验收）。** 新增 POSIX 进程树冻结/递归发现/叶节点优先终止与退出等待；Windows 使用 `taskkill /T /F` 并等待 UtilityProcess 退出。正常完成、超时、取消和 `dispose()` 统一调用清理器；单元测试覆盖 POSIX 树层级、发现期间出现的新后代及 Windows 分支。仍需在真实 macOS / Windows Electron 环境验证，不把 UtilityProcess.kill() 当作整个进程树清理。
- [x] **P2-09 CodeBuddy 总预算。** 一次用户请求最多 12 个模型轮次（6 次 Query、每次最多 2 轮）；应用 Host 工具与兼容模式文本工具调用共用 80 次请求级预算；兼容模式工具结果总输出最多 256 KiB；仍受现有 5 分钟请求超时约束。Provider 内部原生工具由 SDK 权限和轮次限制约束，不声称由应用计数器逐个计数。
- [x] **P2-10 未使用 Runtime 入口清理。** 确认 `executeSkill()` / `SkillExecutionRequest` / Worker 的 `execute` 分支没有产品调用点；按 Agent Skills“脚本不会由导入器执行”的产品边界移除死入口，保留 Code Mode 使用的 UtilityProcess。同步修订 Runtime 和 Agent Skills 文档。

## 验证清单

- [x] TypeScript typecheck
- [x] 全部 Vitest 单元测试
- [x] Layout Engine 独立测试
- [x] Markdown-only Plugin 不能获得或保留可执行运行时授权（Vitest 回归测试已加入）
- [x] Schedule Browser Profile partition ID 稳定且按 Schedule 隔离（Vitest 回归测试已加入）
- [x] Schedule Browser Tool Context 不会回退到用户 Active Tab（Vitest 回归测试已加入）
- [ ] CodeBuddy 真实运行验证：Expert 只授权 Workspace read 时，不能读取 Workspace 外文件
- [ ] Copilot / CodeBuddy 各自的 Agent Run 期间切换 Tab 验证
- [ ] Sidepanel：左右/上下停靠、隐藏、窗口缩放、Tab Group 切换、浮动/重新停靠
- [ ] Pure Agent：右侧 Browser 显示/隐藏、切换 Files/Results、窗口缩放
- [ ] WorkspaceDocument v1 偏好迁移、四方向停靠、显隐和面板比例的 v2 往返回归测试
- [ ] macOS：真实 UtilityProcess 取消/超时及多层子进程清理验证
- [ ] Windows：真实 UtilityProcess 取消/超时及 taskkill /T 清理验证

## CI 更新记录

- 2026-11-22：WorkspaceDocument 单一布局状态提交 `b37101c` 的 GitHub Actions Build run [44996665271](https://github.com/saga/architect-agent-desktop/actions/runs/44996665271) 已通过：`npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均成功。新增布局迁移、四方向停靠、显隐及分栏比例往返测试已纳入 Vitest。

- 2026-11-22：最新 Schedule Browser OAuth / cleanup 修复提交 `71ce796` 的 GitHub Actions Build run [44995645403](https://github.com/saga/architect-agent-desktop/actions/runs/44995645403) 已通过：`npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均成功。此轮包括 Electron 45 popup 类型修正、Profile 子窗口安全策略和 WebContents 生命周期清理。
- 2026-11-22：Schedule Browser Session 主体提交 `0499fed` 的 GitHub Actions Build run [44994616328](https://github.com/saga/architect-agent-desktop/actions/runs/44994616328) 已通过；follow-up 生命周期清理提交 `2e839da` 的 Build run [44994804904](https://github.com/saga/architect-agent-desktop/actions/runs/44994804904) 也已通过。两次 validate 均完成 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试。
- 2026-11-22：最新提交 `64e7e0b` 的 GitHub Actions Build run [44989449265](https://github.com/saga/architect-agent-desktop/actions/runs/44989449265) 已完成且成功。validate job 中 `npm ci`、TypeScript typecheck、全部 Vitest、应用 build 和 Layout Engine 独立测试均通过；本次加入的 Markdown-only Plugin 授权回归测试包含在该 Vitest 结果中。当前工作流仅验证构建，不执行 Windows/macOS 安装包打包，因此不能据此声称安装包已通过跨平台验证。
- 当前 CI 仅验证构建，不执行 Windows/macOS 安装包打包，也不替代真实 Electron BrowserWindow / Session 的 GUI 验收。

## 本轮完成定义

P2-01 当前完成的是授权边界第一阶段：插件启用与可执行运行时授权已经分开，纯 Markdown 插件无法获得运行时授权。混合插件在启用且运行时获批后仍由 Provider 原生加载整份插件快照；如未来要对 Skills、Commands、Agents 做逐组件授权，需要进一步收紧快照投影和 Provider Adapter，不能仅增加 UI 开关。

P2-03、P2-05、P2-07、P2-08 仍未全部完成。P2-05 已加入统一状态模型、旧数据迁移和回归测试，等待 CI 验证；P2-08 已加入首版进程树清理实现和自动化单元测试，但尚未完成真实 macOS / Windows 运行验收，因此保持未勾选。

Action 项目勾选表示相关代码与自动化回归测试已经加入；上面的验证清单则需要实际 CI、Provider 或 GUI 环境确认。当前 CI 结果将在 Action Plan 更新记录中记录，不会仅因为提交成功就标记为通过。
