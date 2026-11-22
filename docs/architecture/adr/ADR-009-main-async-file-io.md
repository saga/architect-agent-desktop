# ADR-009：Main 文件 I/O 异步化与 CPU 工作边界

**状态：** 已采纳并完成实现、CI 与性能基准验证  
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

## 性能基准结果

- 历史性能数据采集环境：GitHub Actions Linux runner，Node.js v24.22.3。该 runner 仅用于当时的算法性能对比，不代表产品目标平台；后续基准工作流固定在 macOS runner 执行。
- 插件包：259 个文件，数据文件合计 8 MiB；Skill ZIP：5 个文件，解压后 8 MiB。
- 同步基线 `7dfd411` → 当前异步实现：插件导入 34.76 → 110.45 ms；运行授权/指纹 31.42 → 96.64 ms；重复扫描 126.56 → 340.31 ms；Skill ZIP 导入 326.53 → 42.05 ms；组合总耗时 520.67 → 591.33 ms。
- 最大定时器延迟 520.17 → 21.11 ms；组合总耗时增加约 13.6%，Main 最大阻塞降低约 96%。这个取舍优先保障 Electron Main 进程交互响应；CRC 查表后，ZIP 导入 CPU 开销不再需要独立 Worker/UtilityProcess。
- Build run [44998687413](https://github.com/saga/architect-agent-desktop/actions/runs/44998687413) 与 Benchmark run [44998687395](https://github.com/saga/architect-agent-desktop/actions/runs/44998687395) 均成功。

## 验收

- 插件指纹、Capability 探测、验证、导入、授权、快照和 Provider 投影全链路使用异步文件 I/O。
- Agent Skill 扫描、导入、ZIP 解压落盘、启停、删除和指令读取全链路使用异步文件 I/O。
- Main IPC、Copilot Runtime 与所有单元测试均等待异步操作完成。
- 原有安全校验与批准指纹撤销语义保持不变。
- TypeScript、全部 Vitest、应用 build 和 Layout Engine 独立测试全部通过。
- 同步/异步性能对比完成，Main Event Loop 最大定时器延迟降低约 96%。
- 在代表性插件包规模下采集改造前后 Main Event Loop 延迟、文件导入耗时和 Skill ZIP 导入耗时；只有测量证明 CPU 处理造成明显阻塞时才考虑 Worker/UtilityProcess。
