# ADR-007：UtilityProcess 子进程树清理

**状态：** 已采纳，第一阶段代码与单元测试已加入；等待 macOS / Windows 真实运行验收  
**日期：** 2026-11-22

## 背景

Code Mode 在 Electron UtilityProcess 中执行受信任的本地生成代码。生成代码可以调用 Node.js API 并派生子进程。Electron 的 `UtilityProcess.kill()` 只终止 UtilityProcess 自身，不保证其派生进程同步退出；超时、取消或应用关闭时可能留下孤儿进程。

UtilityProcess 是进程隔离和崩溃隔离边界，不是安全沙箱。本 ADR 只解决宿主已决定结束一次执行后的资源回收，不把进程清理描述为权限隔离。

## 决策

1. 正常完成、失败、超时、取消和 Runtime `dispose()` 共用 `terminateProcessTree`，结束流程等待清理完成后再释放执行记录。
2. Windows 使用 `taskkill.exe /PID <pid> /T /F`，让操作系统按进程树终止 UtilityProcess 及其子进程，并等待根进程退出。
3. macOS / Linux 先对 UtilityProcess 根 PID 发送 `SIGSTOP`，再通过 `ps` 重复读取 PID/PPID 关系，并冻结新发现的后代；树稳定后按深度从叶节点向根节点发送 `SIGKILL`，最后等待所有已发现进程退出。僵尸进程视为已停止执行，等待其父进程回收。
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
- 当前自动化测试通过注入进程表和信号发送器验证算法与平台分支，不替代真实 Electron 进程、多层子进程及 macOS / Windows 环境验收。

## 验收

- POSIX：多层子进程均被停止，结束顺序为叶节点优先；清理器等待已发现进程退出。
- POSIX：清理扫描期间新增的后代会在根进程被冻结的情况下被再次发现并停止。
- Windows：使用 `taskkill /T /F`，并等待根进程退出。
- 正常完成、失败、超时、取消和应用退出均不会绕过统一清理路径。
- macOS / Windows 真实 Electron 环境完成取消、超时、多层子进程和应用退出测试。
