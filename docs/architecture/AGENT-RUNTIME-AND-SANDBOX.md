# Agent Runtime、Code Mode 与安全沙箱设计

**状态：** JavaScript Code Mode 已实现；Native Skill Runtime 不属于当前产品执行路径；UtilityProcess 不构成安全沙箱  
**范围：** Electron 主进程、Agent Skills、本地 Workspace 与 JavaScript Code Mode  
**目标：** 明确 JavaScript Code Mode 的权限和隔离边界；Skill 文件仅作为 Agent 指令上下文，不提供本地脚本执行入口，也不提供独立的生成代码编译执行后端。

## 1. 设计结论

Electron 内置 Node.js 可以执行本地 JavaScript/TypeScript 编译产物，也可以加载 npm 依赖。Electron 的 UtilityProcess 能把执行任务放入独立 Node.js 子进程，降低执行崩溃对主进程的影响。

但必须区分：

- **UtilityProcess 是进程隔离和故障隔离，不是安全沙箱。** 它仍以当前用户身份运行，默认可以访问当前用户可访问的文件、环境变量、网络和子进程。
- **node:vm 不是安全边界。** 不应把它用于执行不可信的 LLM 代码。
- **Capability API 是宿主授权接口，不是 OS 隔离。** 只有当执行环境无法绕过 API 直接调用宿主能力时，Capability 才能形成有效的访问边界。
- **Workspace 路径不是沙箱。** 设置 cwd 或把工作目录传给 Agent，不会阻止脚本访问工作区以外的文件。

当前只有一条 Agent 代码执行路径：

1. **JavaScript execute_code**：Code Mode 用于组合 Agent 暴露的工具 API，运行在 Electron UtilityProcess 中。UtilityProcess 可直接访问 Node.js API，因此这条路径不是安全沙箱，不应承载需要抵御恶意代码的任务。
2. **Skill 指令资源**：导入的 `SKILL.md`、Commands 和 Agents 是上下文内容，不是脚本执行请求。当前没有 Native Skill Runtime，也不根据 Skill 目录中的脚本自动执行代码。
3. **Generated Code**：不提供独立的编译执行路径。JavaScript `execute_code` 仅用于编排当前已授权工具，不应被视为不可信代码的安全执行环境。

不能把 UtilityProcess、node:vm、Worker Thread 或 Prompt 约束描述成不可信代码的安全边界。

## 2. 目标架构

    Agent / LLM
       |
       v
    Agent Runtime API
       |
       +-- Execution Policy
       |     +-- JavaScript execute_code -> UtilityProcess (tool orchestration only)
       |     +-- SKILL.md -> instruction context only; no script execution entry
       |
       +-- Capability Host
       |     +-- Workspace: list / read / write
       |     +-- Browser / MCP / Tools: host adapters
       |
       +-- Lifecycle
             +-- timeout / cancellation
             +-- process exit / crash handling
             +-- output and log limits
             +-- Agent Trace integration point

Runtime 后端只负责执行和生命周期；Capability Host 负责授权与实际操作；Agent/LLM 不直接获得 Electron API、IPC 对象或主进程对象。

## 2.1 Workspace 自主权限档位

Agent Settings 新增 Workspace 权限。用户显式选择该档位后，Agent 可在当前 Task 选定的 Workspace 内自动调用 Host-mediated 文件工具（list/read/search/write），不再要求每次修改都切换到 Allow all。

该授权不是任意本机文件访问，也不是 OS Sandbox：

- 文件工具只接收 Workspace 相对路径；Host 解析真实根目录，拒绝绝对路径、路径穿越和符号链接，并校验打开文件的身份与大小。
- Task 没有 Workspace 时，文件操作失败关闭，不会回退到用户 Home 或应用目录。
- 全局权限与 Expert 权限上限、Expert 工具 allowlist 仍取交集。
- CodeBuddy 原生 Bash / 文件工具、MCP、插件可执行运行时、浏览器 JS/CSS/CDP 和 JavaScript execute_code 不因 Workspace 档位而开放。
- Workspace 档位选择持久化为 Agent 设置；执行时资源范围动态绑定当前 Task 的 Workspace。它不是逐路径独立 Grant，也不提供对 Workspace 外目录的临时授权。
- Workspace 写入允许覆盖工作区内已有文件。此模式表示用户信任 Agent 在所选项目内进行常规开发修改；删除、部署、发布、发送消息、购买和生产变更等外部或不可逆动作不属于此授权。

Shell 自主执行仍需跨平台 OS Sandbox；不能将 UtilityProcess、CodeBuddy 的局部 Bash Sandbox 或 Prompt 视为完整隔离。

## 2.2 Provider 发布边界

正式公开构建只支持 GitHub Copilot SDK。CodeBuddy SDK 是本机开发测试适配器，不属于正式产品支持矩阵，也不要求与 Copilot SDK 保持完整功能对等。

开发者在仓库根目录的 .env 中设置 ARCHITECT_AGENT_DEV_MODE=true 才能在未打包的本机运行中启用 CodeBuddy。缺少该配置时默认为 Copilot-only；打包构建无论环境变量如何设置都强制 Copilot-only。Renderer Provider 列表、IPC、Agent configure/model inspection/request dispatch 均由 Main 进程的同一 Dev Mode 状态控制，不能仅靠隐藏 UI 开关启用。

## 3. 第一阶段已实现的基础

代码位于 **src/main/runtime/**：

- **runtime-types.ts**：执行请求、结果、Capability 和 Handler 类型。
- **runtime-capabilities.ts**：Workspace list/read/write 的宿主端实现。
- **utility-process-runtime.ts**：启动 Code Mode UtilityProcess，执行超时、取消、进程退出、Tool Broker 调用计数及输出限制。
- **utility-worker.ts**：运行 JavaScript Code Mode，并通过 IPC 向宿主请求 Tool Broker 能力。
- **runtime-capabilities.ts**：Workspace list/read/write 的宿主端实现；是否开放由执行请求中的 Capability 集合控制。
- **tests/utility-process-runtime.test.ts**：验证并发 Code Mode 请求的 Tool Broker 上下文隔离。

Code Mode 使用 Tool Broker 将模型生成的短程序限制在 Agent 当前已授权的工具 API 上；Worker 仍可直接访问 Node.js API，因此 Tool Broker 不是对 Worker 进程本身的安全隔离。

### 当前边界

Native UtilityProcess 中的 Skill 仍然可以直接调用 Node.js 的 fs、process、child_process、网络 API，或者绕开提供的 api。因此：

- 只允许执行可信来源的本地 Skill。
- 不要把从网络下载、未经审查的插件脚本自动标记为可信。
- 不要把 Capability 列表当成对任意 Node.js 代码的强制限制。
- 不要把 Native UtilityProcess 后端用于执行未经审查的 LLM 生成代码。

当前 UtilityProcess Runtime 只用于 JavaScript Code Mode。Plugin Registry 中的 Markdown Skill、Command 和 Agent 仍然作为指令资源处理；插件脚本、Hook、MCP、LSP 和 Mod 走单独的插件运行时授权，不会调用 Native Skill Runtime。

## 4. Skill 指令与 Code Mode 的关系

Skill 与 Code Mode 不是同一种执行能力。

| 项目 | Markdown Skill | JavaScript Code Mode |
|---|---|---|
| 来源 | 用户导入或随插件提供的 Markdown | Agent 为组合已授权工具而生成的短程序 |
| 处理方式 | 纳入指令上下文 | 在 UtilityProcess 中执行 |
| 是否执行 Skill 目录脚本 | 否 | 不适用；Code Mode 不会自动发现或加载 Skill 脚本 |
| Node.js 原生 API | 不适用 | 技术上可访问，不是安全边界 |
| 工具权限 | 不会因为 Skill 文本而增加权限 | 每次调用经 Tool Broker 检查，但直接 Node API 可绕过 |
| 当前状态 | 已实现，指令型资源 | 已实现，不作为安全沙箱 |

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
- [x] UtilityProcess Code Mode 执行后端。
- [x] 删除无调用路径的 Native Skill Runtime；Skill 入口不会被导入器或 Agent 自动执行。
- [x] Workspace list/read/write Capability。
- [x] 超时、AbortSignal 取消、进程退出处理。
- [x] 输出和日志大小限制。
- [x] Generated Code 默认拒绝执行。
- [ ] 将 Code Mode 生命周期和结果接入 Agent 工具注册表。
- [ ] 将 Runtime 事件接入现有 Agent Trace Store。
- [ ] 增加进程级资源限制和运行状态 UI。

### Phase 2：受控 Skill 工作流

- 明确 Skill 信任来源和用户授权流程。
- 插件 Manifest 增加可选脚本声明，但默认不执行。
- 依赖安装采用隔离目录、锁文件和依赖完整性校验。
- 运行时只暴露 Skill 声明且用户授权的 Capability。
- 增加恶意路径、符号链接、超时、异常退出和输出洪泛测试。

### Phase 3：Code Mode 与 Agent 协作

- Agent 先读取可用 API/Capability Schema，再生成短程序。
- 代码、输入、输出和 Capability 请求均关联同一个 Trace。
- 执行失败可返回错误给 Agent 修正，但重试仍受相同权限和资源限制。
- 写入、外部网络和有副作用的工具继续经过宿主策略检查。
- 不把 LLM 的自我声明、Prompt 约束或 Skill 文档当作授权凭据。

## 8. 安全验收标准

- 主进程不执行 LLM 生成的任意代码。
- Renderer 和远程网页不能访问 Runtime IPC 或 Node.js 对象。
- JavaScript `execute_code` 不得被描述成安全沙箱，且不能用于承载需要抵御恶意代码的执行任务。
- 未声明或未授权的 Capability 调用被 Host 拒绝。
- Workspace 路径穿越、绝对路径和符号链接访问被拒绝。
- 超时、取消和 UtilityProcess 崩溃不会使主进程挂起。
- 结果、日志和 Capability 返回值有大小上限。
- 文档清楚区分进程隔离、Runtime 隔离和 OS 级安全边界。
