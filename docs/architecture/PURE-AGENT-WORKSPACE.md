# Pure Agent 工作界面

## 目标与模式

应用提供两种可以互相切换的 Agent 工作模式：

- **Sidepanel**：保留原有浏览器 + Agent 面板布局，适合围绕当前网页进行操作。
- **Pure Agent**：独立的三栏任务工作区，适合持续性的研究、文件处理、开发和自动化任务。

模式和面板尺寸保存在应用本地配置中。切换模式不创建新的 Provider 或 Agent Runtime，也不丢弃浏览器标签、Task 或对话记录。

## 三栏布局

Pure Agent 使用左、中、右三栏。

左栏负责工作导航：New task、Schedule、Expert、Workspace 文件夹和应用配置。Workspace 列表根据已创建的 Task 聚合，同一个文件夹下可以有多个 Task。

中栏负责 Agent 交互：当前 Task、Expert 选择、完整消息流、工具执行结果和输入区。它复用现有 AgentPanel、Copilot/CodeBuddy Provider、Code Mode、工具权限及 Trace。

右栏提供 Browser、Files、Results 三个视图。右栏默认关闭；展开后默认宽度与左栏、中栏大致形成 1:2:2 的视觉比例。两条分隔线可拖动，尺寸会持久化。右栏关闭或切换到 Files/Results 时，Main Process 会将 Browser WebContentsView 隐藏；选择 Browser 后再按实际 DOM Bounds 显示。

## Task 与会话隔离

Task 是独立的工作单元，核心字段包括：

- id：Task 标识。
- sessionId：对应 Trace Store session_messages 的独立会话 ID。
- workspacePath：Task 绑定的本地文件夹。
- expertId：可选的 Expert 角色。
- 创建、更新时间及最近执行时间。

Task 元数据保存在应用 userData 下的 agent-tasks.json。完整消息与 Trace 仍保存在 Agent Data SQLite 中，Task 的 JSON 会话文件仅作为兼容回退。旧版按 Workspace 路径生成的 Session ID 会作为迁移入口，因此已有默认会话可以继续读取。

切换 Task 时，Main Process 切换 Workspace 和 Expert，并重置 Provider 会话，避免 SDK 会话上下文跨 Task 串联。消息保存和 Provider 事件都带 Task 对应的会话 ID；同一 Workspace 下的不同 Task 不共享 transcript。

Task 标题初始为 New task，首次发送后根据用户指令生成标题。Schedule 每次执行也创建独立 Task，历史结果不会覆盖用户正在查看的对话。

## Workspace

Workspace 是一个本地文件夹。左栏根据 Task 的 workspacePath 聚合 Workspace；一个 Workspace 可以包含多个 Task。添加 Workspace 通过系统目录选择器完成。

Workspace 文件预览通过 Main Process 的既有 workspace-files API 读取，仍遵循路径规范化、符号链接检查、UTF-8 文本和大小限制。Pure Agent 的 Files 面板不会直接从 Renderer 读取任意本机文件。

## Expert

Expert 是本地角色预设，包含：

- 名称和简介；
- System Prompt；
- 工具权限上限；
- 可选 Plugin Skills；
- 可选 Tool 范围。

Expert 绑定到 Task，而不是全局替换 Provider 配置。Expert 的权限只能收紧 Agent Settings 的全局权限，不能提升全局权限。例如全局为 Browser-only 时，Allow all Expert 仍不能获得文件或本机工具权限。

Copilot 与 CodeBuddy 都注入 Expert System Prompt 和选定的 Plugin Skills。Copilot 的自定义工具及 Code Mode Broker 按当前权限和 Expert Tool 范围过滤。CodeBuddy 的自定义 MCP Tools 与内置工具也按 Expert 范围限制；文件读写能力仍受当前 Workspace 和全局权限约束。

Expert 数据保存在 agent-experts.json。删除 Expert 会将关联 Task 和 Schedule 的 Expert 引用清空，不删除 Task 历史。

## Schedule

Schedule 是本机持久化的自动执行定义，包含 Prompt、Workspace、Expert、首次运行时间和重复规则（一次、每天、每周）。

Main Process 的调度器在应用运行期间每 15 秒检查到期任务。到期时它会创建专属 Task、切换该 Task 的 Workspace/Expert，调用当前配置的 Provider，并保存用户指令和 Agent 结果。任务完成后恢复用户原先选中的 Task。单次任务执行后自动停用；周期任务按本地日历日期推进，避免把每日任务固定为 24 小时 UTC 间隔。

**执行边界：** 调度器不是系统后台服务。应用退出或操作系统休眠期间不会保证执行；应用启动后会立即检查到期任务，并在应用运行期间继续轮询。Schedule 继承当前全局 Agent 设置和权限，Expert 只能进一步收紧权限。执行开始后，应用会暂时阻止用户切换 Task、Workspace、Expert、Agent 设置或提交另一个请求，避免共享 Provider 实例被并发改写。

Schedule 元数据保存在 agent-schedules.json，执行结果保存在该次运行 Task 的 Session/Trace 中。

## 持久化位置

以下文件位于 Electron userData 目录：

- agent-tasks.json：Task 索引和 Workspace/Expert 关联。
- agent-experts.json：Expert 预设。
- agent-schedules.json：定时任务。
- agent-workspace-preferences.json：模式、左右宽度、右栏可见性和当前视图。
- active-agent-task.json：最近选中的 Task。

对话与 Trace 仍由现有 Agent Data SQLite 存储，Workspace 文件不会复制到应用数据目录。

## 不在本次范围内

- 不提供退出应用后的后台调度服务、系统 LaunchAgent/Task Scheduler 或唤醒电脑能力。
- 不引入新的 Agent Provider、Agent SDK、AI SDK 或 UI 组件包。
- 不把 Agent Task、Schedule 或 Expert 同步到云端。
- 不把 UtilityProcess 视为安全沙箱；现有 Code Mode 安全边界仍按 Agent Runtime 与安全沙箱设计执行。
