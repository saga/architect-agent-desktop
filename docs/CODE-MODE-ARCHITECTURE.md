# Code Mode 执行架构

## 设计原则

Code Mode 是 Agent 的一种执行策略，不是新的模型 Provider，也不是 Cloudflare 服务。本项目借鉴 Cloudflare Code Mode 的核心设计模式和 API 组织方式，但不依赖 `@cloudflare/codemode`，不使用 Cloudflare Workers、Dynamic Worker Loader 或 Cloudflare 部署环境。

Copilot 与 CodeBuddy 共用同一套 `execute_code` 工具和 Electron UtilityProcess Runtime。Provider 只负责注册工具；模型通过一次代码执行编排多个工具调用。

简单任务继续使用普通 Tool Calling。多步编排、并行操作、批量读取和中间数据处理适合使用 Code Mode，以减少模型往返，并避免把中间结果反复放入模型上下文。

## 借鉴的 Code Mode 概念

| 概念 | 本项目实现 |
| --- | --- |
| Tool Provider | 将现有平面工具注册表按 namespace 分组，例如 `browser`、`workspace` |
| Resolved Provider | 将工具描述解析为可调用函数，并保留输入 Schema 与 handler |
| Schema-driven Types | 从 Zod JSON Schema 生成 TypeScript API 声明，注入 `execute_code` 描述 |
| Code Normalization | 去除 Markdown fence，并将普通代码片段规范化为 async 函数 |
| Executor abstraction | UtilityProcess Runtime 负责执行，不承担工具定义、模型选择或权限策略 |
| Tool RPC | 通过 IPC 将 namespace.method 调用转交 Main Process Tool Broker |

这些概念在本地 `src/main/runtime/codemode.ts` 实现，没有引入 Cloudflare 包或其运行时依赖。

## 模型看到的 API

工具按权限和当前 Workspace 动态生成。模型只能看到当前请求可用的 namespace 和方法。

```ts
// Browser namespace
browser.getCurrentPage()
browser.snapshot()
browser.listTabs()
browser.navigate({ url: "https://example.com" })

// Workspace namespace（仅在 Workspace 和权限允许时提供）
workspace.listFiles()
workspace.readFile({ path: "src/main/index.ts" })
workspace.writeFile({ path: "src/main/index.ts", content: "..." })
```

每个方法的参数类型从现有 Zod Schema 转换为 JSON Schema，再生成 TypeScript 声明。工具执行仍调用原有 handler，不复制 Browser、Workspace 业务逻辑。

## 执行链路

1. Agent 通过 `execute_code({ code })` 提交 JavaScript。
2. Code Mode 根据当前权限过滤现有工具，并将其组织为 namespace Provider。
3. 从 Provider Schema 生成模型可见的 TypeScript API 描述。
4. Code Normalizer 处理代码围栏和函数包装。
5. Main Process 为本次执行创建独立 Electron UtilityProcess，并传入 namespace 列表及代码。
6. UtilityProcess 将 `browser.method()`、`workspace.method()` 转换为 IPC RPC。
7. Main Process Tool Broker 根据本次执行的 Provider allowlist 分发到原有 handler，并保留输入 Schema 校验、permission gating 和 Trace。
8. UtilityProcess 在完成、失败、超时或取消后终止。

## 权限与工具调用

- Provider 只从当前权限模式允许的工具中构建；未暴露的 namespace/method 不会进入模型 API 描述。
- Broker 再次校验 method allowlist，并对输入执行原有 Zod Schema 校验。
- 所有 Code Mode 工具调用都记录 `tool.call`、`tool.result` 或 `tool.failed` Trace。
- 普通 Tool Calling 与 Code Mode 并存。审批或高风险动作不应仅因为进入 Code Mode 就绕过原有策略。
- Code Mode 仅通过 Broker 调用桌面工具；工具权限不限制生成代码直接访问 Node.js API。

## 运行时边界

每次执行独立 UtilityProcess，支持 async/await、Promise、Promise.all、工具 RPC、日志、超时、取消和结果大小限制。默认单次执行超时 30 秒，代码输入上限 100 KB，结果和 Broker 累计输出上限 256 KB，日志最多 200 条。

UtilityProcess 是独立 Node.js 进程，主要用于故障隔离和执行生命周期管理，不是安全沙箱。生成代码仍可能访问 Node.js API、文件系统、网络、子进程及当前用户权限下的其他资源。工具权限只约束 Broker 暴露的工具，不会限制生成代码直接调用 Node.js API。

本阶段不实现 QuickJS、`node:vm` 沙箱、容器或 OS 级隔离，也不保留相关试验代码。若未来需要执行不可信代码，应另行设计 OS 级隔离，包括文件系统挂载、网络策略、进程/系统调用限制、身份权限和 CPU/内存资源配额，并通过独立安全评审后再实现。

## 代码边界

- `runtime/codemode.ts`：Provider 组织、Provider 解析、Schema 类型生成、代码规范化及 Tool 描述。
- `runtime/utility-process-runtime.ts`：UtilityProcess 生命周期、IPC Broker、超时、取消和资源限制。
- `runtime/utility-worker.ts`：namespace proxy 与生成代码执行。
- `copilot.ts`：复用现有工具 handlers，按权限构建 Provider，并将同一 `execute_code` 暴露给 Copilot 和 CodeBuddy。

不引入新的 Agent SDK，不改变 Copilot/CodeBuddy Provider，也不把 Code Mode 变成另一套工具实现。
