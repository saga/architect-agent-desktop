# ADR-007：UtilityProcess 子进程树清理

**状态：** 已采纳；真实 OS 进程树与真实 Electron UtilityProcess 生命周期自动化均已在 macOS / Windows CI 通过，等待完整 Agent Code Mode GUI / Provider 人工验收  
**日期：** 2026-11-22

## 背景

Code Mode 在 Electron UtilityProcess 中执行受信任的本地生成代码。生成代码可以调用 Node.js API 并派生子进程。Electron 的 `UtilityProcess.kill()` 只终止 UtilityProcess 自身，不保证其派生进程同步退出；超时、取消或应用关闭时可能留下孤儿进程。

UtilityProcess 是进程隔离和崩溃隔离边界，不是安全沙箱。本 ADR 只解决宿主已决定结束一次执行后的资源回收，不把进程清理描述为权限隔离。

## 决策

1. 正常完成、失败、超时、取消和 Runtime `dispose()` 共用 `terminateProcessTree`；无论 PID 是否已就绪，最后都调用 Electron `UtilityProcess.kill()` 作为根进程兜底。进程树清理完成后再释放执行记录。
2. Windows 使用 `taskkill.exe /PID <pid> /T /F`，让操作系统按进程树终止 UtilityProcess 及其子进程，并等待根进程退出。
3. macOS（POSIX）先对 UtilityProcess 根 PID 发送 `SIGSTOP`，再通过 `ps` 重复读取 PID/PPID 关系，并冻结新发现的后代；树稳定后按深度从叶节点向根节点发送 `SIGKILL`，最后等待所有已发现进程退出。僵尸进程视为已停止执行，等待其父进程回收。
4. PID 未就绪或进程已退出时不执行树扫描；清理失败时保留错误信息，并回退调用 Electron 的 `UtilityProcess.kill()`。
5. 清理器有界扫描和退出等待，避免 Main 进程无限期等待；不为此引入新的第三方依赖。

## 不采用

- 不把 `UtilityProcess.kill()` 当作整棵进程树的终止机制。
- 不新增常驻进程监控器或定时轮询器。
- 不将这套生命周期清理称为对不可信代码的安全隔离。
- 不引入容器、虚拟机或额外 Worker 层来解决当前信任模型下的进程回收问题。

## 已知边界

- 进程树清理针对仍可从 UtilityProcess PID/PPID 关系发现的后代。进程若在宿主开始清理前主动 daemonize、重新托管或逃离原有父子关系，单纯的 PID 树枚举不能提供绝对保证。
- POSIX 实现依赖系统 `ps` 命令；Windows 实现依赖系统 `taskkill.exe`。
- 自动化测试既通过注入进程表验证算法边界，也会真实启动 Node 父/子/孙进程树并调用操作系统清理路径。另有真实 Electron UtilityProcess 集成测试：生产 Runtime fork Worker，Worker 再派生 Node 子进程，分别执行取消、超时和 `dispose()`，并确认 Worker 及子进程 PID 退出。GitHub Actions 只在 macOS、Windows 两个目标平台执行。真实 Electron GUI 内运行完整 Agent Code Mode 的人工验收仍单独保留。

## 自动化跨平台验证

- `tests/process-tree.integration.test.ts` 在当前操作系统真实启动三层 Node 进程树，调用 `terminateProcessTree`，并验证根进程与孙进程均不再运行。
- `Build` workflow 只使用 macOS / Windows 两个平台，执行 typecheck、全部 Vitest、应用 build、Layout Engine、Schedule Session 与真实 UtilityProcess 集成测试。
- `tests/utility-process-runtime.integration.mjs` 启动独立 Electron 主进程，实际运行生产 `UtilityProcessAgentRuntime`；Worker 再派生 Node 子进程。取消、超时及 `dispose()` 三条路径均验证 Worker 和后代 PID 已退出。
- Build run [45005886227](https://github.com/saga/architect-agent-desktop/actions/runs/45005886227) 的 macOS / Windows jobs 均通过完整验证，并分别生成 macOS ARM64 DMG/ZIP 与 Windows x64 NSIS 安装包。Artifact 仅上传安装文件；当前未配置代码签名或 Apple 公证。
- Main 侧 `UtilityProcess` 的 `message` 事件接收的是直接 payload；只有 Utility Worker 内的 `process.parentPort` 使用 `MessageEvent.data`。Runtime 已按该 API 形态解析消息，并保留对包装对象的兼容处理。此前 mock 使用 `.data` 包装掩盖了主进程消息解析问题。
- 自动化测试验证 OS 进程树算法和真实 Electron Runtime 清理接线，不替代完整 GUI Agent Code Mode 手工验收。

## 跨平台 CI 结果

- Build run [45005886227](https://github.com/saga/architect-agent-desktop/actions/runs/45005886227) 的 macOS 与 Windows jobs 均成功，覆盖 TypeScript、完整 Vitest、真实 Node 进程树、真实 Electron UtilityProcess / 子进程清理、应用 build、Layout、Schedule Session 与平台原生安装包构建。
- 该结果验证操作系统进程树清理实现与真实 Electron Runtime 接线；未声称完成完整 Electron GUI Agent Code Mode 的人工验收。

## 验收

- POSIX：多层子进程均被停止，结束顺序为叶节点优先；清理器等待已发现进程退出。
- POSIX：清理扫描期间新增的后代会在根进程被冻结的情况下被再次发现并停止。
- Windows：使用 `taskkill /T /F`，并等待根进程退出。
- 正常完成、失败、超时、取消和应用退出均不会绕过统一清理路径。
- macOS / Windows 真实 Electron GUI 环境完成 Code Mode 取消、超时和应用退出测试。


## 真实 Electron UtilityProcess 自动化回归

新增 `npm run test:utility-process-runtime`，由 CI 在 macOS / Windows 分别启动独立 Electron 主进程，并通过生产代码 `UtilityProcessAgentRuntime` 实际 fork `utility-worker.js`。Worker 使用 Tool Broker 报告 UtilityProcess PID，并从 Worker 内派生一个真实 Node 子进程；测试分别触发 AbortSignal 取消、Runtime 超时，以及调用 `dispose()`，并检查 Worker 和派生子进程的 PID 均从操作系统进程表消失。该测试覆盖真实 Electron UtilityProcess 与 Runtime 的清理接线，不替代带真实 Agent Provider、Browser 工具及完整 GUI 的 Agent Code Mode 人工验收。
