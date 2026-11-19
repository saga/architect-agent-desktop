# Code Mode 执行架构

## 设计原则

Code Mode 是 Agent 的执行策略，不是新的模型 Provider，也不是新的权限级别。Copilot 与 CodeBuddy 共用同一套 `execute_code` 工具、System Instructions 和 Electron UtilityProcess Runtime。Provider 只负责注册工具及注入系统提示词；模型负责选择直接调用工具还是生成代码编排工具。

简单、独立的操作继续使用普通 Tool Calling。多步骤依赖、并行调用、批量处理、循环以及有意义的数据过滤、转换、比较和聚合适合使用 Code Mode。目标是减少模型与工具之间的往返，并让中间数据留在执行进程内处理。

## 模型提示词设计

提示词分为两个互补部分：

- **Code Mode System Instructions**：稳定的执行策略，定义何时直接调用工具、何时使用 `execute_code`，以及代码编写、数据处理、错误处理和权限边界要求。Copilot 与 CodeBuddy 共用同一段指令。
- **execute_code Tool Description**：每次根据当前权限可用的工具动态生成，提供 namespace、方法说明、参数类型和返回类型。它同时说明代码输入格式、异步调用方式及 Runtime 限制。

System Instructions 不重复全部 API Schema；工具描述不承担全局 Agent 规则。两者职责分离，避免提示词膨胀和 Provider 行为漂移。

## 执行策略

| 场景 | 推荐方式 |
| --- | --- |
| 读取当前页面、列出文件等单个独立操作 | 直接 Tool Calling |
| 先读取页面，再根据结果点击或填写 | Code Mode（如需多步依赖） |
| 多个互不依赖的页面或文件读取 | Code Mode + Promise.all |
| 批量读取后筛选、聚合或比较 | Code Mode，在 Runtime 内处理中间结果 |
| 单次简单导航或点击 | 直接 Tool Calling |
| 涉及提交、购买、发送、删除、资金转移或账户安全变更 | 遵循既有安全策略，不因 Code Mode 而放宽 |

模型可以根据实际任务复杂度选择，不应为了使用 Code Mode 而强制将所有请求代码化。

## API 类型描述

工具按当前权限和 Workspace 状态动态生成 namespace。每个方法包含：

- 从现有 Zod JSON Schema 生成的输入参数 TypeScript 类型；
- 工具说明；
- 明确的返回类型（例如普通文本工具返回 `Promise<string>`，截图工具返回文本或带图像数据的结果）；
- 受当前权限过滤后的可用 API 清单。

JSON Schema 的本地 `$defs` / `definitions` 引用会在类型生成时解析；无法安全解析或递归深度过大的结构降级为 `unknown`，避免生成错误声明。

## 执行链路

1. Agent 在 System Prompt 中接收统一 Code Mode 执行策略。
2. Agent 同时看到普通工具和 `execute_code` 工具。
3. 复杂任务时，模型通过 `execute_code({ code })` 提交 JavaScript。
4. Code Mode 根据当前权限过滤现有工具，并将其组织为 namespace Provider。
5. 从 Provider Schema 生成 API 类型描述，并注入 `execute_code` Tool Description。
6. Main Process 创建独立 Electron UtilityProcess，并传入代码与 namespace 列表。
7. UtilityProcess 将 `browser.method()`、`workspace.method()` 转换为 IPC RPC。
8. Main Process Tool Broker 再次校验 allowlist 和 Zod 输入 Schema，调用既有 handler 并记录 Trace。
9. 执行完成、失败、超时或取消后，UtilityProcess 终止。

## 权限与运行时边界

- 普通工具和 Code Mode 使用同一组现有 handlers。
- Code Mode Provider 只从当前权限模式允许的工具中构建。
- Broker 再次校验方法 allowlist 和输入 Schema；工具调用 Trace 保持统一。
- 生成代码的直接 Node.js API 访问不受 Tool Broker 权限约束。System Prompt 明确要求模型不得使用直接 Node.js API，但这只是模型行为约束，不是技术隔离。
- UtilityProcess 是独立 Node.js 进程，主要用于故障隔离和生命周期管理，不是安全沙箱。生成代码仍可能访问文件系统、网络、子进程及当前用户权限下的其他资源。
- 本阶段不实现 QuickJS、`node:vm` 沙箱、容器或 OS 级隔离，也不保留相关试验代码。未来若执行不可信代码，必须另行设计 OS 级隔离并进行安全评审。

## 代码边界

- `runtime/codemode.ts)：统一系统指令、Provider 组织、Schema 类型生成、代码规范化及 Tool Description。
- `runtime/utility-process-runtime.ts)：UtilityProcess 生命周期、IPC Broker、超时、取消和资源限制。
- `runtime/utility-worker.ts)：namespace proxy 与生成代码执行。
- `copilot.ts`：按权限构建 Provider，并将相同的 System Instructions 和 `execute_code` 暴露给 Copilot 与 CodeBuddy。

不引入 Cloudflare 包，不改变 Copilot/CodeBuddy Provider，不增加 AI SDK，也不把 Code Mode 变成另一套工具实现。
