# Agent Runtime、Code Mode 与安全沙箱设计

**状态：** 第一阶段 Runtime 基础设施实现；OS 级安全沙箱和 LLM Code Mode 暂不开放  
**范围：** Electron 主进程、Agent Skills、本地 Workspace、后续动态代码执行  
**目标：** 在不引入第二套 Node.js 安装的前提下，为可信 Skill 提供独立执行进程，并为未来 Code Mode 建立可替换的 Runtime 与 Capability 边界。

## 1. 设计结论

Electron 内置 Node.js 可以执行本地 JavaScript/TypeScript 编译产物，也可以加载 npm 依赖。Electron 的 UtilityProcess 能把执行任务放入独立 Node.js 子进程，降低执行崩溃对主进程的影响。

但必须区分：

- **UtilityProcess 是进程隔离和故障隔离，不是安全沙箱。** 它仍以当前用户身份运行，默认可以访问当前用户可访问的文件、环境变量、网络和子进程。
- **node:vm 不是安全边界。** 不应把它用于执行不可信的 LLM 代码。
- **Capability API 是宿主授权接口，不是 OS 隔离。** 只有当执行环境无法绕过 API 直接调用宿主能力时，Capability 才能形成有效的访问边界。
- **Workspace 路径不是沙箱。** 设置 cwd 或把工作目录传给 Agent，不会阻止脚本访问工作区以外的文件。

第一阶段采用两条明确路径：

1. **trusted-skill**：由用户明确认可、来源可信的本地 Skill 脚本，可以使用 Electron UtilityProcess 中的 Node.js 执行。此模式不提供恶意代码隔离保证。
2. **generated-code**：LLM 临时生成的代码，当前明确拒绝执行。必须等 OS 级 Sandbox Runtime 落地并通过安全测试后才能启用。

不允许为了让 Code Mode“看起来可用”，把动态代码直接交给 UtilityProcess、node:vm、Worker Thread 或主进程执行。

## 2. 目标架构

    Agent / LLM
       |
       | Skill invocation / generated program
       v
    Agent Runtime API
       |
       +-- Execution Policy
       |     +-- trusted-skill -> Native UtilityProcess Backend
       |     +-- generated-code -> OS Sandbox Backend (future; disabled)
       |
       +-- Capability Host
       |     +-- Workspace: list / read / write
       |     +-- HTTP: future handler
       |     +-- Database: future handler
       |     +-- Browser / MCP / Tools: future host adapters
       |
       +-- Lifecycle
             +-- timeout
             +-- AbortSignal cancellation
             +-- process exit / crash handling
             +-- output and log limits
             +-- Agent Trace integration point

Runtime 后端只负责执行和生命周期；Capability Host 负责授权与实际操作；Agent/LLM 不直接获得 Electron API、IPC 对象或主进程对象。

## 3. 第一阶段已实现的基础

代码位于 **src/main/runtime/**：

- **runtime-types.ts**：执行请求、结果、Capability 和 Handler 类型。
- **runtime-capabilities.ts**：Workspace list/read/write 的宿主端实现。
- **utility-process-runtime.ts**：启动 UtilityProcess、校验 Skill 入口路径、权限检查、超时、取消、进程退出和输出限制。
- **utility-worker.ts**：在 UtilityProcess 中加载 Skill 模块，提供最小 API Facade，并通过 IPC 请求宿主 Capability。
- **tests/agent-runtime-sandbox.spec.ts**：验证 Capability 未授权时拒绝调用。

Skill 模块应导出 run(args, api) 或默认函数。API 当前提供：

    api.workspace.listFiles(path?, recursive?)
    api.workspace.readFile(path)
    api.workspace.writeFile(path, content)
    api.log.info(message)
    api.log.warn(message)
    api.log.error(message)

Workspace 文件操作只接受相对路径，拒绝路径穿越和符号链接；读写上限为 256 KB，列表限制 2,000 项和 8 层递归。写入要求父目录已经存在，不会自动创建目录。

Capability 每次调用都在宿主端检查是否授权。自定义 Handler 可通过构造函数注入；尚未实现的 HTTP、Database、Browser、MCP 和 Tool Capability 不会被伪装成已可用功能。

### 当前边界

Native UtilityProcess 中的 Skill 仍然可以直接调用 Node.js 的 fs、process、child_process、网络 API，或者绕开提供的 api。因此：

- 只允许执行可信来源的本地 Skill。
- 不要把从网络下载、未经审查的插件脚本自动标记为可信。
- 不要把 Capability 列表当成对任意 Node.js 代码的强制限制。
- 不要把当前执行后端用于 LLM 生成的临时代码。

当前 Runtime 是可供宿主集成的基础模块，不会自动改变现有 Plugin Registry 的声明式插件行为；现有插件继续只提供 Markdown Skill、Workflow 和宿主 Tool 引用。

## 4. Skill 与 Code Mode 的关系

两者共享 Runtime API、Capability 定义、生命周期和 Trace 格式，但执行策略不同。

| 项目 | Trusted Skill | Generated Code |
|---|---|---|
| 来源 | 用户认可的本地脚本 | LLM 即时生成 |
| Runtime | UtilityProcess / Node.js | OS Sandbox Backend |
| Node.js 原生 API | 可用，但仅限可信代码 | 默认不可直接访问 |
| Capability | 宿主授权检查 | 宿主授权检查 + OS 限制 |
| 网络 | 不因 Capability 而自动安全 | 默认禁止，按任务开放 |
| 文件系统 | 进程仍可访问用户权限范围 | 仅挂载任务目录 |
| 依赖 | Skill 自身依赖 | 预构建运行镜像/受控依赖集 |
| 当前状态 | Runtime 基础已实现 | 禁止执行 |

Code Mode 的价值在于让模型把多个操作组合成一段程序，例如遍历架构文档、读取文件、查询数据、调用工具并生成报告。它不是“给模型一个 eval()”，而是让模型编排有明确输入输出和权限边界的 API。

建议后续使用短生命周期任务环境：每次执行创建临时目录和独立进程/容器，执行结束收集结构化结果与日志，然后销毁环境。不要让一个长期运行的沙箱积累其他任务的文件、凭证或状态。

## 5. 什么才算安全沙箱

安全沙箱应由可信边界强制执行，而不是依赖 Prompt 或代码约定。最低要求：

1. **文件系统**：默认看不到用户 Home、SSH Key、云凭证、应用配置和其他项目；只挂载当前任务所需目录。
2. **网络**：默认禁网；开放时限制协议、域名、端口和出站路径，防止 SSRF、内网探测和数据外传。
3. **进程**：禁止或严格限制创建子进程、调试器、后台守护进程。
4. **身份**：使用低权限用户或 OS 沙箱身份，不继承宿主应用的敏感环境变量。
5. **资源**：CPU、内存、进程数、文件大小、输出大小和运行时间均有上限。
6. **生命周期**：任务级隔离，完成、超时、取消或崩溃后清理临时资源。
7. **宿主 API**：只通过窄接口提供能力；每次调用由 Host 校验权限、参数和目标资源。
8. **可观测性**：记录执行 ID、代码/Skill 来源、Capability 请求、结果、退出状态和资源限制触发情况。日志不是防篡改审计账本。

单独使用容器、Namespace、V8 Isolate 或 Deno 权限都不能自动满足所有要求，必须结合威胁模型和配置验证。

## 6. 可选技术方案

### 6.1 JavaScript Runtime 级隔离

| 方案 | 适用性 | 限制 |
|---|---|---|
| isolated-vm | V8 Isolate，适合纯 JS | 不是 OS 安全边界；Native addon 和 Node ABI 维护成本 |
| QuickJS / QuickJS-NG | 轻量、无 Node 全局对象，适合小型 Code Mode | 需要自行提供 Host API；Node/npm 兼容性弱 |
| Deno Permissions | 文件、网络、环境变量、子进程的显式权限模型 | 额外 Runtime；权限机制不能替代 OS 隔离 |

Runtime 级隔离可减少语言层面的能力暴露，但不应独立承担高风险不可信代码执行。

### 6.2 OS 级隔离

| 平台 | 方案 | 说明 |
|---|---|---|
| Linux | Bubblewrap + seccomp + cgroups | 轻量，文件系统和 Namespace 配置灵活；需要维护挂载和资源策略 |
| Linux | NSJail | Namespace、seccomp、资源限制集成度较高；配置复杂 |
| Linux | gVisor | 用户态内核隔离，适合更高风险任务；兼容性和开销需要评估 |
| Linux/KVM | Firecracker | MicroVM 强隔离；部署和资源成本较高，不适合作为第一阶段桌面默认方案 |
| macOS | App Sandbox / 受限子进程能力 | 需要签名、Entitlements 和平台集成；不能把 sandbox-exec 当长期稳定产品 API |
| Windows | AppContainer、Restricted Token、Job Objects | 组合实现文件/网络身份限制和资源管理；需要原生集成与兼容性测试 |

Linux 的 Bubblewrap/NSJail 不能直接解决 macOS 和 Windows。桌面应用应定义统一 Sandbox Backend 接口，再按平台实现，而不是声称一个 Linux 容器方案跨平台可用。

### 6.3 可参考的开源项目

- [Bubblewrap](https://github.com/containers/bubblewrap)：Linux Namespace 沙箱工具。
- [NSJail](https://github.com/google/nsjail)：Linux 进程隔离、seccomp 和资源限制。
- [gVisor](https://github.com/google/gvisor)：用户态内核隔离。
- [Firecracker](https://github.com/firecracker-microvm/firecracker)：轻量 MicroVM。
- [isolated-vm](https://github.com/laverdet/isolated-vm)：V8 Isolate。
- [QuickJS-NG](https://github.com/quickjs-ng/quickjs)：轻量 JavaScript 引擎。
- [Deno](https://github.com/denoland/deno)：具有权限控制的 JS/TS Runtime。
- [Piston](https://github.com/engineer-man/piston)、[Judge0](https://github.com/judge0/judge0)：多语言代码执行服务，可参考 API 和任务生命周期。
- [E2B](https://github.com/e2b-dev)：面向 AI Agent 的代码执行沙箱产品与开发模式，重点参考任务环境和 SDK 设计，不代表其云端方案可以直接嵌入桌面端。
- [Google Code Sandboxing](https://developers.google.com/code-sandboxing)：沙箱技术与威胁模型参考。

## 7. 后续实施顺序

### Phase 1：Runtime 基础（本次）

- [x] Runtime 请求/结果类型和 Capability 类型。
- [x] UtilityProcess Native Node 执行后端。
- [x] Trusted Skill 入口路径校验。
- [x] Workspace list/read/write Capability。
- [x] 超时、AbortSignal 取消、进程退出处理。
- [x] 输出和日志大小限制。
- [x] Generated Code 默认拒绝执行。
- [ ] 将 Runtime 工具接入 Agent 工具注册表。
- [ ] 将 Runtime 事件接入现有 Agent Trace Store。
- [ ] 增加进程级资源限制和运行状态 UI。

### Phase 2：受控 Skill 工作流

- 明确 Skill 信任来源和用户授权流程。
- 插件 Manifest 增加可选脚本声明，但默认不执行。
- 依赖安装采用隔离目录、锁文件和依赖完整性校验。
- 运行时只暴露 Skill 声明且用户授权的 Capability。
- 增加恶意路径、符号链接、超时、异常退出和输出洪泛测试。

### Phase 3：真正的 Code Mode Sandbox

- 定义 SandboxBackend 接口，统一 create / execute / cancel / destroy。
- 先选一个平台做 OS 级后端 PoC，不在没有隔离实现时开放 Code Mode。
- 默认无网络、只挂载临时任务目录、无宿主凭证。
- 加入 CPU、内存、进程数、磁盘和输出限制。
- 通过越权文件访问、网络探测、子进程逃逸尝试、资源耗尽和清理测试。
- 再逐步实现 macOS、Linux、Windows 后端。

### Phase 4：Code Mode 与 Agent 协作

- Agent 先读取可用 API/Capability Schema，再生成短程序。
- 代码、输入、输出和 Capability 请求均关联同一个 Trace。
- 执行失败可返回错误给 Agent 修正，但重试仍受相同权限和资源限制。
- 写入、外部网络和有副作用的工具继续经过宿主策略检查。
- 不把 LLM 的自我声明、Prompt 约束或 Skill 文档当作授权凭据。

## 8. 安全验收标准

- 主进程不执行 LLM 生成的任意代码。
- Renderer 和远程网页不能访问 Runtime IPC 或 Node.js 对象。
- Generated Code 在 OS Sandbox 未启用时必须失败关闭。
- 未声明或未授权的 Capability 调用被 Host 拒绝。
- Workspace 路径穿越、绝对路径和符号链接访问被拒绝。
- 超时、取消和 UtilityProcess 崩溃不会使主进程挂起。
- 结果、日志和 Capability 返回值有大小上限。
- 文档清楚区分进程隔离、Runtime 隔离和 OS 级安全边界。
