# ADR-002：Agent Data 与 Session 运行留痕

- 状态：已采纳
- 日期：2026-11-19

## 背景

工作区对话 JSON 只服务于聊天界面，最近操作日志也有容量上限且采用尽力写入。它们无法还原一次 Agent 请求中的模型响应、工具调用、失败过程和上下文信息，也不适合后续分析。

common-agent-lib 已提供可复用的设计约定：Agent Event 统一事件信封、稳定的 Session/Trace/Turn 标识、事件序号、脱敏和 payload 完整性标记；Context Explorer 负责读取和分析事件，而不是负责持久化。

## 决策

### 1. Agent Data 与 Workspace 分离

- Workspace 是 Agent 操作的项目目录。
- Agent Data 是工作台自己的运行数据目录，默认是 Electron userData 下的 `agent-data/`。
- 用户可以在「Agent 与插件配置」中选择其他本地目录。
- Agent Data 目录包含 `agent-traces.sqlite`，不写入项目 Workspace。
- 切换目录只切换后续读写目标，不自动移动或删除旧目录数据；切换前后数据均保留在原位置。

### 2. Session 与 Trace 标识

- Session 标识当前工作区对应的持久会话；按工作区路径哈希生成稳定 ID，不把路径本身当作 ID。
- 每次用户发起的 Agent 请求生成独立 Trace ID。
- Provider 事件、工具调用和结果使用当前 Trace ID 关联。
- Event ID 和 Sequence 由本地记录器生成，不由模型提供。
- Workspace 路径作为事件上下文保存，便于按项目分析。

### 3. 留痕范围

记录以下事件：
- 请求开始、完成、失败和取消。
- 用户输入、当前可见会话历史快照、Agent 输出增量和最终消息。
- Provider 可观察到的运行事件。
- Agent 工具调用、输入参数、结果和错误。
- Session 加载、保存、清空。
- Provider、模型、权限设置和工作区上下文。

Copilot 和 CodeBuddy 的可观察事件能力不同。宿主工具调用会记录完整输入和结果；CodeBuddy 运行事件按 SDK 实际提供内容保存。没有从 Provider 边界捕获到的完整请求/响应不得伪装成完整快照，后续扩展时必须保留 payload 完整性标记。

### 4. 存储与安全

- 使用本地 SQLite，事件按追加方式写入，使用事务分配 Trace 内序号。
- 对密码、Token、API Key、Authorization、Cookie、Bearer 等敏感字段进行递归脱敏。
- 单个事件 payload 最大 1 MiB；超限时保留有标记的预览，并标记为不完整。
- 记录失败必须显式暴露，不得静默吞掉必需的留痕写入错误。
- Agent Data 是本地诊断和运行证据，不是防篡改审计账本，也不替代业务授权、合规审计或外部副作用确认。
- 不记录模型隐藏推理内容。原始提示词、可见回复和工具参数仍可能包含业务数据，目录应由用户妥善保护。

## 当前实现边界

第一阶段提供本地 Agent Data 目录配置、SQLite 事件存储、Session/Trace 查询，以及请求、Provider、工具和会话事件采集。当前可见聊天记录仍保留现有 Workspace 隔离机制；Agent Data 中同时保存会话快照和运行事件。

后续可直接接入 common-agent-lib 的 `@saga/agent-context-explorer` 展示 Session Timeline、Tool Call Graph、模型调用和 Context Provenance。Explorer 不应复制或接管 Recorder 的持久化职责。
