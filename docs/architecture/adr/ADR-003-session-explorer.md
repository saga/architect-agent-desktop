# ADR-003：内置 Session Explorer 与完整会话持久化

- 状态：已采纳并实现
- 日期：2026-11-19

## 背景

Agent Data 已经把运行事件写入本地 SQLite，但此前缺少可视化查询入口。会话 JSON 快照还受 200 条消息上限约束，无法作为完整的长期分析记录。

## 决策

1. Session Explorer 直接作为桌面应用 Renderer 的内置功能实现，不依赖或引入 common-agent-lib 等 npm package。
2. 继续使用现有 Agent Data 目录和 agent-traces.sqlite，不建立第二套日志数据库。
3. 新增 session_messages 表，按 Session 和消息 ID 独立保存消息。消息更新采用 upsert；清空会话时删除该 Session 的消息记录。
4. 会话加载优先读取 SQLite 消息记录；没有 SQLite 记录时回退读取旧 JSON 会话文件，以兼容升级前的数据。
5. 移除原有 200 条消息截断。历史 JSON 文件中已经被截断的消息无法恢复；升级后产生的消息会完整写入 SQLite。
6. Session Explorer 提供会话记录、事件时间线、工具调用、模型分析和 Context 调试视图。
7. 事件时间线查询最近最多 1,000 条；会话消息从 SQLite 独立读取，最多 50,000 条。Token 用量只展示 Provider 实际返回的数据，不进行估算。
8. 保留现有事件脱敏、载荷大小限制和 SDK 可观察性边界。SDK 调用记录不代表底层网络请求或防篡改审计证据。

## 数据边界

- Session ID 继续由工作区路径稳定生成，不同工作区的数据相互隔离。
- Agent Data 目录切换后，后续写入进入新目录；旧目录的数据保留在原位置，不自动迁移。
- 消息内容在写入 SQLite 前会执行现有 Bearer 凭据脱敏。
- session_messages 是可查询的完整会话记录；agent_events 仍负责记录运行过程、工具调用和 Provider 事件。
- 本地 SQLite 可供诊断和分析，但不是不可篡改的合规审计账本。

## 结果

Session Explorer 可以在 Agent 面板中直接打开，使用现有 Trace 查询 API 和 SQLite 数据。后续分析能力应继续建立在这套存储和事件模型上，不再另建独立的 Session 日志系统。
