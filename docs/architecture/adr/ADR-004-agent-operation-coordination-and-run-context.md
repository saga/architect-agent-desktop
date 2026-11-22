# ADR-004：Agent 操作协调与 Run 上下文

**状态：** 已采纳，第一阶段已实现  
**日期：** 2026-11-22

## 背景

Main Process 同时管理 Agent 请求、Task 切换、Schedule、Memory 维护和浏览器工具。此前这些操作通过多个布尔状态在 IPC Handler 中分别判断，容易遗漏；浏览器工具又直接读取全局 `activeTabId`，用户切换页面后可能改变正在运行的 Agent 的操作目标。

## 决策

1. Main Process 继续作为 Task、Agent Run 和持久化状态的事实来源，不在 Renderer 引入第二套业务状态管理系统。
2. 所有会修改 Agent 上下文或共享维护资源的操作，使用同一套忙碌判断：Schedule、异步维护、Agent 请求、Task 切换和 Provider 执行。
3. 跨异步边界的 Memory Embedding 操作必须先取得维护占用，再执行 I/O；退出路径统一释放。
4. 每次 Agent Run 固定自己的浏览器工具 Tab ID。工具通过 Run 上下文解析目标 Tab，而不是在每次调用时读取 UI 的全局 Active Tab。
5. 用户可以切换可见 Tab；正在被 Agent Run 使用的 Tab 不允许通过应用的关闭或导航操作改变。该机制解决应用内 UI 对工具目标的漂移，但不等同于独立 Browser Session，也不能阻止页面脚本改变同一页面。

## 不采用

- 不引入 Redux、全局事件总线或通用工作流状态机。
- 不把 Provider 的 built-in 文件工具当作 Workspace 安全边界。受 Expert 限制的文件访问必须通过应用 Host Handler。
- 不把进程隔离或 Prompt 约束描述成 OS 级安全边界。

## 验收

- CodeBuddy 的受限 Expert 不获得通用 `Read/Write/Edit/Glob/Grep` 文件能力。
- CodeBuddy Workspace 读写走应用 Host Handler。
- 维护 I/O 与 Agent 请求、Task 切换及 Schedule 不可并发修改共享上下文。
- 一次 Agent Run 的 Browser Tool 不因 UI 切换 Tab 而跳到另一 Tab。
- 所有占用在成功、异常和取消路径释放。
