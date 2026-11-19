# Code Mode 执行架构

## 目标

Code Mode 是 Agent 的一种执行策略，不是新的模型 Provider。Copilot 与 CodeBuddy 共用 `execute_code` 工具及 Electron UtilityProcess Runtime；Provider 只负责注册工具并将调用转发给同一套 handler。

简单任务继续使用普通 Tool Calling。需要多步编排、批量读取或中间数据处理的任务，可以使用 Code Mode，在 UtilityProcess 内完成循环、聚合和过滤，避免每一步都往返模型上下文。

## 执行链路

1. Agent 通过 `execute_code` 提交 JavaScript。
2. Main Process 为本次执行创建独立 UtilityProcess。
3. UtilityProcess 执行异步 JavaScript，提供 `tools.call(name, input)` 和 `log.*` API。
4. `tools.call` 通过 IPC 返回 Main Process，由 Main Process 执行现有 Tool Handler。
5. 现有 handler 继续执行权限判断、结果发布和 Trace 记录。
6. 执行结束、超时或取消后，终止本次 UtilityProcess。

## 当前阶段边界

- 每次 Code Mode 执行独立 UtilityProcess。
- 支持 async/await、Promise、工具 RPC、日志、超时、取消和结果大小限制。
- Code Mode 与普通 Tool Calling 并存；模型自行选择。
- Copilot 和 CodeBuddy 使用同一工具实现，不复制业务 handler。
- Tool Broker 只约束经 `tools.call` 发起的调用。

## 安全边界与后续演进

UtilityProcess 是独立 Node.js 进程，主要用于故障隔离和执行生命周期管理，不是安全沙箱。生成代码仍可能访问 Node.js API、文件系统、网络、子进程及当前用户权限下的其他资源。工具权限只约束 Broker 暴露的工具，不会限制生成代码直接调用 Node.js API。

本阶段明确不实现 QuickJS、`node:vm` 沙箱、容器或 OS 级隔离，也不把这些试验代码留在运行链路中。后续若需要安全执行不可信代码，应另行设计 OS 级隔离，包括文件系统挂载、网络策略、进程/系统调用限制、身份权限和 CPU/内存资源配额，并通过独立安全评审后再实现。

## 运行限制

默认单次执行超时 30 秒，代码输入上限 100 KB，结果和 Broker 累计输出上限 256 KB，日志最多 200 条。执行完成、失败、取消或超时均终止子进程。
