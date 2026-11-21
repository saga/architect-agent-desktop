# Agent Trajectory 与 Context Explorer

## 目标

在 Agent 执行期间提供两种互补的只读检查视图：

- **Trajectory**：回答 Agent 做了哪些步骤、先后顺序、工具调用结果和耗时。
- **Context Explorer**：回答每次模型调用向 Provider SDK 提交了哪些上下文、工具定义和参数，以及当前能观察到的请求、响应和上下文变化。

两者消费同一份 Agent Trace，但使用独立投影。Trajectory 不承担 Context 数据模型；Context Explorer 也不负责重排聊天消息。Chat 会话本身不依赖这两个视图。

设计参考：
- [DeepSeek Harness — ui-trajectory](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/client/ui-trajectory)：按 Turn 分组的 Step Ledger、真实时间概览、工具调用/结果检查。
- [common-agent-lib — agent-context-explorer](https://github.com/saga/common-agent-lib/tree/main/packages/agent-context-explorer)：Provider-neutral ContextSnapshot / ContextRun / ContextEvent 模型、Agent Trace Adapter 和 ContextDebugger。

## 入口与布局

在 Agent 面板打开 Session Explorer，主内容提供以下独立标签：

1. **执行 Trajectory**：按 Trace/Turn 展示用户输入、模型请求、工具调用、模型回复、权限事件、压缩和运行错误。
2. **Context Explorer**：复用 common-agent-lib 的 ContextDebugger。
3. 原有会话记录、事件时间线、工具调用、模型分析和采集来源视图继续保留。

Trajectory 包含：
- Turn 状态、Provider/Model、开始和结束时间；
- Step 顺序、事件类型、输入/输出摘要；
- 模型请求和响应合并为同一个模型调用行；
- 工具调用和结果按 toolCallId 关联；旧记录没有 ID 时按同 Trace 的工具名称 FIFO 关联；
- 可选中的 Step 检查器，显示原始输入、输出和关联 Trace 事件；
- Overview 时间条只根据实际记录的开始/结束时间绘制，不对运行中步骤推算完成时间。

## Runtime 事件合同

Main Process 继续使用现有 AgentTraceStore 和 SQLite agent_events 表。每次 Agent Send 的 traceId 作为一个 Turn 的稳定关联 ID；每次 Provider SDK 调用有独立 requestId；每次工具调用有独立 toolCallId。

关键事件：
- turn.started / turn.completed / turn.failed
- provider.request / provider.response
- provider.message.delta / provider.reasoning.delta / provider.codebuddy.event
- tool.call / tool.result / tool.failed
- permission.requested 等权限生命周期事件

provider.request 和 provider.response 带相同 requestId。请求事件包含 ContextSnapshot，响应事件包含相同请求的响应快照。Context Explorer Adapter 按 requestId 将开始与结束记录合并为一个 ContextRun，不把一次模型调用展示成两次。

工具事件在调用前写入 tool.call，执行后写入 tool.result 或 tool.failed，并保留相同 toolCallId。这样既能在执行中显示 Pending，也能在结束后计算真实调用耗时，并保留无匹配结果的孤立事件以便排查。

## ContextSnapshot 与完整性边界

桌面端目前能观测的是 **应用提交给 Copilot SDK / CodeBuddy SDK 的输入和 SDK 返回结果**，不是 Provider 传输层最终 HTTP payload。

因此快照记录：
- 桌面端实际提交的 prompt；
- 应用拼装的 system prompt；
- 当前应用可见的本地工具定义和 JSON Schema；
- 模型、thinking level、权限、工作目录、Context Window、已配置 MCP Server 名称等调用参数；
- SDK 返回的响应及可以读取的 response text；
- 采集范围和说明 warnings。

当前无法完整读取：
- Copilot 管理的持久 Session 历史和 SDK 内部追加的消息；
- CodeBuddy CLI 内部注入的 system prompt、项目指令或隐藏的工具定义；
- SDK/CLI 运行期间 Provider 端实际收到的完整序列化请求；
- 没有由 Provider/SDK 明确返回的 Token usage、Context Window 占用或 KV Cache 数据。

所以 provider.request / provider.response 的 payloadComplete 显式标记为 false，ContextSnapshot warnings 解释边界。UI 不把 SDK 输入冒充成完整 Provider HTTP 请求，不估算 Token，也不虚构 Context Window 占用。

Token usage 仅当 Provider/SDK 的实际事件包含可识别的 usage 字段时展示。Trajectory 的耗时只在调用开始与结束事件都存在时展示；进行中的步骤显示运行状态和开始标记，不显示猜测的完成耗时。

## common-agent-lib 复用

为了避免应用依赖一个尚未确认发布的 workspace 包，当前将 saga/common-agent-lib/packages/agent-context-explorer/src 作为本地 vendored source 放在：

src/renderer/context-explorer/

复用文件包括：
- model.ts：ContextSnapshot、ContextRun、ContextEvent、ContextSession 等契约；
- normalize.ts、diff.ts、session.ts：上下文消息归一化、快照比较、工具调用图和时间线投影；
- agent-trace-adapter.ts：Agent Trace -> Context Explorer 数据适配；
- ContextDebugger.tsx、ContextExplorer.tsx：调试 UI。

Adapter 增加了一项桌面端适配：request/response 两条记录若具有同一个 requestId，会合并为一条 ContextRun；payloadComplete 只要任一侧不完整就保持 false。后续升级时应从 common-agent-lib 同步上述源文件及这些本地适配差异。

## 数据安全与存储

Trace 仍写入本机 SQLite agent_events，沿用现有敏感字段脱敏与单事件大小上限。Context Snapshot 不另建数据库，不改变已有 Session 消息记录。

界面只读，不会触发模型调用、执行工具、修改权限或重放请求。原始请求/响应内容继续受 AgentTraceStore 的脱敏和 payload size cap 约束。

这不是 Provider 端请求审计或合规证据。底层 SDK/CLI 未暴露的事件仍不可见；本视图不能替代 Provider API 级别的请求日志。

## 验证

- trajectory-projector 单元测试覆盖模型请求/响应配对、工具调用/结果配对、孤立工具结果和进行中耗时。
- Context Explorer Adapter 测试覆盖 request/response 合并、实际响应和 payloadComplete=false 保留。
- 完整验证仍由仓库 GitHub Actions 执行：typecheck、unit tests、build 和 layout tests。
