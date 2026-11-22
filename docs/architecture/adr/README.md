# 架构决策记录（ADR）

| ADR | 决策 | 状态 |
|---|---|---|
| [ADR-001](./ADR-001-plugin-host-boundary.md) | 由宿主应用管理声明式插件包 | 已采纳并实现第一版 |
| [ADR-002](./ADR-002-agent-data-and-tracing.md) | Agent Data、Session 与运行轨迹持久化 | 已采纳并实现第一版 |
| [ADR-003](./ADR-003-session-explorer.md) | 内置 Session Explorer 与完整会话持久化 | 已采纳并实现 |
| [ADR-004](./ADR-004-agent-operation-coordination-and-run-context.md) | Agent 操作协调与 Run 上下文 | 已采纳，第一阶段已实现 |
| [ADR-005](./ADR-005-renderer-owned-browser-geometry.md) | Renderer 提供 Browser View 实际几何 | 已采纳并实现 |
| [ADR-006](./ADR-006-schedule-browser-session-isolation.md) | Schedule 专属 Browser Session 与登录 Profile | 已采纳，第一阶段代码已实现，待跨平台验收 |

Layout Engine 和 Electron 原生视图相关决策记录在以下文档中：

- [Layout Engine 架构设计](../LAYOUT-ENGINE.md)
- [Electron 原生视图布局与 Snapshot 交互设计](../ELECTRON-NATIVE-VIEW-LAYOUT-AND-SNAPSHOT-DESIGN.md)

只有当某项决策尚未在架构文档中清楚说明、且确实需要单独记录时，才新增 ADR。
