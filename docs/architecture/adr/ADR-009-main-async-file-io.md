# ADR-009：Main 文件 I/O 异步化与 CPU 工作边界

**状态：** 已采纳，异步 I/O 第一阶段代码与回归测试已加入；等待 CI 和性能基准  
**日期：** 2026-11-22

## 背景

Electron Main 进程除了 IPC 和 Browser 生命周期，还负责插件目录校验、内容指纹、Provider 插件快照、Agent Skill 导入和指令上下文加载。对目录逐个执行同步 `stat/readdir/read/copy/write` 会阻塞 Main Event Loop；这些动作不应因为运行在 Main 进程就自动使用同步文件 API。

此前 Workspace 文件读写已使用异步 API，但插件和 Skill 文件链路仍包含同步目录遍历、哈希读取、目录复制与 ZIP 落盘。

## 决策

1. Main 中对插件和 Agent Skill 的常规文件 I/O 使用 `node:fs/promises`。IPC、Agent 初始化与 Copilot Provider 调用方必须等待文件操作完成，不能返回未完成的 Promise 或提前发布授权状态。
2. 插件内容指纹计算保持确定性 SHA-256；保留单文件 2 MB、总量 20 MB、4096 个文件、8192 个目录条目和深度 32 限制；通过异步目录句柄、异步文件描述符读取，并继续使用 `O_NOFOLLOW` 与打开前后文件身份/大小复核。
3. 插件导入先复制到临时目录，重新校验，再原子重命名安装；Provider 运行快照异步复制后重新计算指纹，内容不一致时拒绝启动并清理快照。
4. Agent Skill 的目录扫描、导入、启停、删除、ZIP 读取和解压结果落盘以及指令读取改用异步文件 API；保留 ZIP 路径穿越、CRC、条目数和文件大小校验。
5. 不因为文件 API 异步就额外引入 Worker/UtilityProcess。ZIP CRC 和 `inflateRawSync` 是受大小上限约束的 CPU 计算，先以代表性包规模测量 Main Event Loop 延迟与导入时间，再决定是否隔离 CPU 工作。
6. 小型 MCP Server JSON 配置继续使用同步读写：它不是递归导入/扫描路径，不在本 ADR 的大包文件 I/O 治理范围内；如实际测量发现其成为瓶颈，再单独调整。

## 不采用

- 不把同步文件 API 简单包装在 `async` 函数中。
- 不为异步化而新增文件 Worker、常驻 UtilityProcess 或新的抽象层。
- 不降低指纹、符号链接、路径边界或文件大小校验。
- 不把 ZIP 解压 CPU 成本误记为磁盘 I/O 成本。

## 验收

- 插件指纹、Capability 探测、验证、导入、授权、快照和 Provider 投影全链路使用异步文件 I/O。
- Agent Skill 扫描、导入、ZIP 解压落盘、启停、删除和指令读取全链路使用异步文件 I/O。
- Main IPC、Copilot Runtime 与所有单元测试均等待异步操作完成。
- 原有安全校验与批准指纹撤销语义保持不变。
- TypeScript、Vitest 和应用 build 全部通过。
- 在代表性插件包规模下采集改造前后 Main Event Loop 延迟、文件导入耗时和 Skill ZIP 导入耗时；只有测量证明 CPU 处理造成明显阻塞时才考虑 Worker/UtilityProcess。
