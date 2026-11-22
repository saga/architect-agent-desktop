# 架构审查整改 Action Plan

**基线：** `main` / `edca36a2cc92cda7c8c16eb2a6dfb533031e42f9`  
**更新日期：** 2026-11-22  
**范围：** 安全权限、状态协调、布局几何、进程与任务生命周期  
**完成规则：** 代码和对应回归测试完成后勾选；需要真实 Provider、GUI 或跨平台环境才能证明的事项不得只凭静态检查标记为完成。

## Phase 1 — 权限与边界

- [x] **P1-01 CodeBuddy 文件工具收口。** 受限权限/Expert 不再把 `workspace_read_file` 映射成 CodeBuddy 内置 `Read/Glob/Grep`，而是通过应用 Workspace Host Handler 提供读写；`assisted` 不开放 Provider 原生文件工具。增加工具选择策略单元测试。
- [x] **P1-02 插件指纹扫描有界化。** 在读取文件之前检查单文件 2 MB、总量 20 MB、文件数量和目录深度；打开文件后重新核对文件类型和大小。增加超大文件回归测试。
- [ ] **P2-01 插件组件授权拆分。** 将 Markdown 指令组件（Skills/Commands/Agents）与可执行组件（Hooks/MCP/LSP/脚本/Mods）分成不同授权项，保留内容指纹与运行快照。需要同步调整 UI、注册表版本和 Provider adapter，避免一次改变授权语义。
- [ ] **P2-02 插件目录扫描异步化。** 将目录指纹、Capability 探测和导入校验移出 Main 同步事件路径；先基于实际插件包规模测量，不引入通用线程池。

## Phase 2 — Agent 状态与运行上下文

- [x] **P1-03 统一 Main 操作冲突判断。** 使用共享忙碌判断覆盖 Schedule、Agent 请求、Task 切换、维护和 Provider busy；Memory 写操作不再只检查 Provider busy；Embedding 检查/重建在异步 I/O 前取得维护占用，并在 `finally` 释放。为冲突判断增加独立单元测试。
- [x] **P1-04 AgentPanel 事件初始化竞态。** 在加载 Session 前订阅事件；加载期间暂存事件，恢复 Transcript 后按序回放；按 Task ID 严格过滤，未就绪时禁止提交。
- [x] **P1-05 Pure Agent Snapshot 竞态。** 实时更新先到时，迟到的初始 Snapshot 不得覆盖新状态。
- [x] **P1-06 Run 浏览器 Tab 固定。** 每次 Agent Run 固定工具目标 Tab（包括 Run 开始时没有 Active Tab 的情况），工具不再随 UI 的全局 Active Tab 漂移；应用侧阻止在 Run 期间关闭、导航、后退、前进、刷新或停止该 Tab，并保护键盘快捷键路径。为目标解析与操作阻断增加单元测试。
- [ ] **P2-03 完整 Browser Session 隔离。** 当前 Tab pin 只解决应用 UI 切换导致的目标漂移，不阻止网页脚本或用户内容改变同一 Tab。Schedule 如需无人值守可靠性，应使用独立 Browser Session / 专用 Tab 生命周期，并测试登录态、下载和清理。
- [ ] **P2-04 完整操作状态机替换。** 当前先统一忙碌判断并为长维护操作保留占用；只有在覆盖全部 IPC、Schedule、窗口退出和取消路径后，才考虑替换现有布尔状态。不要为了形式统一引入复杂状态机。

## Phase 3 — Layout 唯一事实来源

- [x] **P1-07 Renderer 拥有实际布局几何。** Sidepanel/Pure Agent 均测量 Browser 内容矩形，并通过统一 IPC 发送完整 `x/y/width/height`。
- [x] **P1-08 删除 Main 的重复布局计算。** Main 只校验、裁剪并应用 Renderer 提供的矩形，不再从 WorkspaceDocument 重新计算 Native Browser View 位置；保留独立 Layout Engine 供布局树计算使用。
- [ ] **P2-05 Layout 树语义收敛。** WorkspaceDocument 继续保存结构、Tab Group 和浮动面板；清理 WorkspaceLayoutState 中与树节点重复的宽度/显示状态，并补迁移和往返兼容测试。
- [x] **P2-06 布局验证规则统一。** 基础树语义统一由 `validateLayout` 校验（ID、split 轴向、比例、splitterSize 和 panel 尺寸）；Document parser 仅保留不可信输入的结构、节点数及深度防护；`validateTree` 复用共享校验。移除未被计算器消费的 `LayoutOptions.minPanelSize`，并补充布局回归测试。

## Phase 4 — 进程、性能和资源回收

- [ ] **P2-07 Main 同步 I/O 治理。** Workspace 搜索、插件指纹和 ZIP 导入先异步化；只有基准证明 CPU 扫描仍阻塞时，才使用 UtilityProcess/Worker Thread。
- [ ] **P2-08 UtilityProcess 子进程树清理。** 实现跨平台进程树终止和等待退出；macOS/Linux 与 Windows 分别验证。不能把 UtilityProcess.kill() 当作整个进程树清理。
- [x] **P2-09 CodeBuddy 总预算。** 一次用户请求最多 12 个模型轮次（6 次 Query、每次最多 2 轮）；应用 Host 工具与兼容模式文本工具调用共用 80 次请求级预算；兼容模式工具结果总输出最多 256 KiB；仍受现有 5 分钟请求超时约束。Provider 内部原生工具由 SDK 权限和轮次限制约束，不声称由应用计数器逐个计数。
- [ ] **P2-10 未使用 Runtime 入口清理。** 对 `executeSkill()` 和 Native Skill Runtime 进行调用链盘点；未接入产品流程的入口应移除或明确标为实验能力。

## 验证清单

- [x] TypeScript typecheck
- [x] 全部 Vitest 单元测试
- [x] Layout Engine 独立测试
- [ ] CodeBuddy 真实运行验证：Expert 只授权 Workspace read 时，不能读取 Workspace 外文件
- [ ] Copilot / CodeBuddy 各自的 Agent Run 期间切换 Tab 验证
- [ ] Sidepanel：左右/上下停靠、隐藏、窗口缩放、Tab Group 切换、浮动/重新停靠
- [ ] Pure Agent：右侧 Browser 显示/隐藏、切换 Files/Results、窗口缩放
- [ ] macOS 与 Windows：UtilityProcess 取消/超时及孤儿进程验证

## CI 更新记录

- 2026-11-22：GitHub Actions Build run [44970135119](https://github.com/saga/architect-agent-desktop/actions/runs/44970135119) 的 `validate` job 已通过：npm ci、TypeScript typecheck、全部 Vitest、应用 build、Layout Engine 独立测试均成功。Windows/macOS 打包仍以该 run 最终 job 结论为准。

## 本轮完成定义

Action 项目勾选表示相关代码与自动化回归测试已经加入；上面的验证清单则需要实际 CI、Provider 或 GUI 环境确认。当前 CI 结果将在 Action Plan 更新记录中记录，不会仅因为提交成功就标记为通过。
