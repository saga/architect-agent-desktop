# Agent 数据分析、文件理解、A2UI 与长期记忆设计

## 目标与边界

本功能把桌面端从“能够操作浏览器和工作区文件的 Agent”扩展为本地数据分析与知识工作环境。核心仍然是现有 Electron 主进程、Copilot Agent、Tool Broker、IPC、Workspace 与 SQLite Session Store，不单独再建一套 Agent Runtime，也不引入云端数据处理依赖。

能力分为四部分：

1. 文档理解：PDF、DOC/DOCX、XLS/XLSX/XLSM，以及 CSV、TSV、JSON、TXT、Markdown。
2. 结构化分析：将表格导入本地 DuckDB，Agent 使用只读 SQL 做汇总、对比、趋势、风险敞口和异常分析。
3. 分析展示：A2UI 1.0 作为主协议，官方 Agent/Core SDK 负责生成和状态管理；A2UI React Renderer 负责 Surface 生命周期。历史会话继续使用 v0.9 Card Renderer。Finance Catalog 集成 Ant Design Charts、G6 和 X6。
4. 长期记忆：复用当前会话记录作为 Transcript 层，再增加 Memory Notes、主题知识页和小型上下文注入索引。

## 整体结构

```text
System File Picker
       |
       v
Main Process Attachment Allow-list
       |
       v
Document Service
  |          |
  |          +---- PDF.js / Mammoth / WordExtractor / node-xlsx
  |                           |
  v                           v
Plain Text + Tables       Structured Worksheet Data
  |                           |
  v                           v
Agent Prompt Context       Workspace DuckDB
                              |
                              v
                      Read-only SQL Tool
                              |
                              v
                    Agent Analysis / Metrics
                              |
                              v
                      A2UI 1.0 Messages
                              |
                              v
                 A2UI Validator + Catalog
                              |
                              v
             A2UI 1.0 React Surface + Finance Catalog
```

## 文件理解链路

### 授权与解析

文件路径只能来自 Electron 系统文件选择器。主进程通过 `realpath` 归一化路径，并按 Task 保存已授权附件集合。IPC 发送时再次校验附件是否属于当前 Task 的授权集合；Agent 的 `document_extract` 工具也只能读取本轮已授权路径。

解析运行在本机，不上传文件。每次最多 20 个附件，单个文件最大 50 MB。解析器不把附件正文当成系统指令：文档内容作为不可信数据写入 Prompt，并明确禁止执行文档内的指令。

### 支持格式与提取行为

| 格式 | 当前处理方式 | 结果 |
|---|---|---|
| PDF | PDF.js 逐页提取文本 | 页码和正文；暂不做 OCR 和版面级表格识别 |
| DOCX | Mammoth 提取正文 | 文本和解析警告 |
| DOC | WordExtractor 提取正文 | 文本 |
| XLS / XLSX / XLSM | node-xlsx / SheetJS 解析工作表 | 每个工作表转换为一张结构化表 |
| CSV / TSV | 本地分隔符解析 | 结构化表 |
| JSON | JSON 解析 | 对象数组转换为结构化表；其他 JSON 作为文本 |
| TXT / MD / LOG | UTF-8 文本 | 正文 |

PDF 若没有提取到文本，会返回“可能为扫描件或仅含图片”的提示，不会把空文本误判成成功解析。OCR 留作独立能力，避免在当前链路中加入额外模型、二进制依赖和不透明的识别结果。

每个工作表最多 50,000 行、100 列；最多处理 30 个工作表。文档原文传入模型的总字符数有单轮上限，超出部分不进入 Prompt，但结构化表仍可通过 DuckDB 工具查询。

## DuckDB 设计

### 数据位置和隔离

DuckDB 数据库文件位于 Electron `userData/agent-analytics`。数据库按 Workspace 路径哈希分区；没有 Workspace 时使用独立的个人分析库。这样不同项目的数据不会混进同一张逻辑表，也不需要用户管理数据库连接。

表由附件导入时自动创建，列名会清洗为安全标识符，并处理清洗后的重名。数值、布尔和日期字段会做有限类型推断；不能确定的字段保留为 VARCHAR。

### SQL 边界

Agent 通过两个工具访问数据：

- `duckdb_list_tables`：列出当前 Workspace 已导入的表。
- `duckdb_query`：执行单条只读 SELECT / WITH 查询。

禁止多语句、写操作和外部文件读取函数；DuckDB 配置关闭外部访问及扩展自动安装。单条 SQL 最大 12,000 字符，最多返回 500 行。分析 SQL 只作用于本应用导入的数据，不把任意本机路径交给模型。

这些约束不是数据库完整安全沙箱的替代品。后续如果需要开放自定义 SQL 模板、脚本执行或数据源连接，应继续通过 Tool Broker 和独立权限控制，而不是放宽 SQL 规则。

## 可视化与 A2UI

### A2UI 1.0 为主协议，v0.9 保留兼容

新会话使用官方 TypeScript Agent SDK、`web_core` 和 React Renderer：

- `@a2ui/agent`：维护模型侧生成器、协议提示和跨轮 Surface 状态。
- `@a2ui/web_core`：协议解析、消息校验、Surface 状态和 Action 事件处理。
- `@a2ui/react`：把已校验的 Surface 渲染为 React 组件。
- Finance Catalog：注册本地的金融图表、知识关系图和可编辑流程图组件。

A2UI 1.0 RendererState 按 Agent Task Session 隔离；新消息增量进入官方 React Renderer / MessageProcessor，Surface 生命周期独立管理。Renderer→Agent 消息由 `@a2ui/web_core/v1_0` 的 `RendererToAgentMessageSchema` 做完整协议校验，再核对 Surface 是否由当前 Task 创建。ActionMessage 交给当前 Task 的 Agent 解释；当前 Finance Catalog 没有注册 Agent Functions，收到 `callAgentFunction` 时返回标准 `agentFunctionResponse.error`，不静默忽略。Renderer 不直接执行 Agent 工具。

旧会话仍通过 Ant Design X Card 的 v0.9 Catalog 渲染。新会话不再把 v0.9 JSON 当作 A2UI 1.0；两种格式有独立的事件类型和解析入口。

### Finance Catalog 组件

| 组件 | 底层技术 | 用途 |
|---|---|---|
| FinanceChart | Ant Design Charts | 折线、面积、柱状、双轴、饼图、散点、雷达、玫瑰、树图、瀑布、桑基等统计和金融图表 |
| KnowledgeGraph | AntV G6 | 只读知识图谱、实体关系、持仓/发行人/行业关系及影响路径 |
| WorkflowDiagram | AntV X6 | 流程图、审批流、数据血缘、Agent 工作流；允许受控编辑和保存 |
| FinancialChart（legacy） | ECharts | 兼容已有 A2UI v0.9 卡片和原有图表输出 |

G6 主要承担关系网络的布局、缩放、节点拖动和选择；X6 承担图形节点、连线和画布编辑，不把二者合并成一个通用图库。Ant Design Charts 用于常见统计图表；ECharts 继续作为现有图表兼容项。

模型只输出 Catalog 约束下的 JSON 数据和属性，不输出 HTML/React/JS，不向 Renderer 传递可执行 formatter。图表、节点、边和画布数据均有大小/数量上限。编辑后的 X6 JSON 通过受控事件回传，不允许它绕过 Tool Broker 去写任意路径。

### 金融分析展示约定

Agent 应先给结论和指标定义，再给图表和明细。例如：

- 净值和收益：累计收益、区间收益、回撤、滚动波动率
- 组合风险：资产类别、行业、区域和发行人集中度，净敞口/总敞口
- 固收分析：收益率、久期、凸性、信用评级分布
- 交易分析：成交量、价格/成本变化、交易前后敞口
- 风险监控：异常值、阈值越界、期间变化和数据质量提示

这些是展示模板，不代表应用自动推断业务口径。数据日期、币种、收益口径、分母、缺失值处理等应由 Agent 在图表说明中写明，遇到定义不清的数据先提示口径限制。

## 长期记忆：从会话历史到持续知识

Anthropic《The components of agent memory》（2026-11-06）提出的核心层次是：Transcript、Memory Notes、Memory Representations 和 Injected Context，并通过 Dreaming 在会话之外或任务间整理、纠错和提升记忆。本项目按相同分层落地，但存储和调度仍保持本地、简单、可审计。

### 四层结构

| 层 | 本项目实现 | 用途 |
|---|---|---|
| Transcript | 现有 Agent Session SQLite `session_messages` 和 FTS5 索引 | 保存对话与工具轨迹，支持按 Workspace 检索 |
| Memory Notes | `agent-memory.sqlite` 的 `memory_notes` 表 | 保存有长期价值的观察、事实、决策、用户偏好和经验 |
| Memory Representations | `memory_representations` 表 | 把多条 Note 组织为主题知识页，可引用来源 Note ID |
| Injected Context | `getInjectedContext()` | 新 Task 注入少量摘要和知识索引，避免完整历史挤占上下文 |

Memory Note 保留 Workspace Scope、标题、正文、标签、创建/更新时间、来源 Session/Trace、访问次数、置顶标记、验证状态和置信度。默认状态为 `unverified`。只有基于原始会话、文件或可靠来源复核后才可标记 `validated`；相互冲突或已过时的内容标记为 `disputed`。

### Dreaming：证据驱动的完整整理事务

Dreaming 不再只是让模型总结历史。它现在有独立状态、证据快照、版本前置条件和原子提交：

```text
Transcript cursor
      |
      v
prepare run + evidence manifest
      |
      v
de-duplicate / redact / inspect evidence
      |
      v
plan Note / relation / knowledge changes
      |
      v
validate sourceRefs + baseVersion
      |
      v
BEGIN IMMEDIATE
  entity changes + versions + audit log + cursor
COMMIT
      |
      v
completed / list / rollback
```

**证据准备**

`memory_dreaming_prepare` 从当前 Workspace 已保存的 Session Transcript 读取 cursor 之后的消息。每次最多处理 160 条（默认 80 条）、证据包不超过 320 KB；单条消息最多 4,000 字符，先做常见密钥/Token 模式脱敏，再保存 source hash、session/message ID、消息类型和时间。超过单条上限时，证据正文会带 `[TRUNCATED]` 标记；Dreaming 必须先通过 `memory_search_history` 回查原始 Transcript，不能把预览片段当成完整证据。证据 ID 按 Run 生成，重试不会与已放弃 Run 的主键冲突。

游标由 `createdAt + sessionId + messageId` 组成。相同毫秒时间戳的消息仍有稳定顺序，分批整理时不会仅按时间戳而漏掉同一批尾部消息。游标只在事务成功提交时前移。

**变更操作**

`memory_dreaming_commit` 接受带理由与来源引用的结构化操作：

- `upsert_note`：创建或更新记忆；更新必须携带读取时的 `baseVersion`。
- `review_note`：根据本次 evidence 更新 `unverified / validated / disputed`。
- `archive_note`：归档重复或失效 Note；置顶条目不能直接归档。
- `supersede_note`：将旧 Note 标记为被新 Note 替代，并建立关系。
- `link_notes`：建立 supports、contradicts、refines、derived_from、related_to、supersedes 关系。
- `publish_knowledge`：把多条活动 Note 整理成有来源的知识页。新建时不需要版本号；更新已有知识页必须传入读取时的 `baseVersion`，避免覆盖并发修改。
- `archive_knowledge`：归档已经失效或被替代的知识页；必须携带当前 `baseVersion`，归档动作进入 Run 审计，并支持随 Run 回滚。

所有操作必须引用当前 Run 的 evidence source ID 并提供 reason。对现有 Note 的改动必须提供版本号；更新已有知识页也必须提供 `baseVersion`。如果在准备后被其他操作更新，整个提交会失败回滚，不会覆盖更新后的内容。

**事务和审计**

SQLite 使用 `BEGIN IMMEDIATE`，一次性提交实体、版本快照、Dreaming 操作前后快照和 cursor。单次提交失败时，所有变更回滚，Run 保持 prepared，cursor 不前移。若证据已评估但没有任何长期知识需要变更，允许 `operations=[]` 提交 no-op Run：记录完成状态并推进游标，但不虚增实体变更数量。旧版本保留在 `memory_versions`，操作记录保存在 `memory_dream_operations`。

Run 状态：

| 状态 | 含义 |
|---|---|
| `prepared` | 已固定证据集，尚未提交 |
| `completed` | 事务成功提交 |
| `abandoned` | 用户/Agent 放弃本次准备，不推进 cursor |
| `rolled_back` | 已撤销最近一次成功提交 |
| `failed` | 预留的失败状态；当前事务错误会自动回滚并保留 prepared，供检查或 abandon |

**回滚**

`memory_dreaming_rollback` 只能回滚当前 Workspace 最新的 completed Run。回滚前逐项比对当前实体与本次提交后的快照；如果之后有人工或 Agent 修改，则拒绝回滚，避免用旧快照覆盖新内容。回滚同样在事务中恢复 Note、知识页、关系和 cursor。

**Agent 的整理策略**

对重要任务，系统提示要求 Agent 主动执行 prepare → evidence review → commit。整理目标不局限于失败记录，还包括成功流程、稳定的用户偏好、项目约定、业务定义、数据口径、重复出现的错误和已解决问题。模型必须区分事实、推测、冲突和时效性信息；证据不足时保持 unverified，矛盾并存时记录 contradicts 或 disputed，不为了减少 Note 数量而删除唯一知识。 对重要、高风险或可能变化的旧 Note，Agent 应通过 `memory_read_source` 按 `sourceId` 读取历史证据快照，并结合 `memory_search_history` 搜索更早 Transcript；不能只凭 Note 自身内容完成自我验证。

当前是 Agent 驱动的任务后整理，Settings → Memory & Dreaming 提供查看 Notes、知识页、关系和 Run 审计的管理界面，并允许手动启动整理、继续处理已有 prepared Run、置顶/取消置顶 Note、归档 Note、放弃 prepared Run 或回滚最近一次提交。手动整理需要当前 Expert 开放长期记忆工具，且 Agent 工具权限至少为 assisted。也可以让 Agent 在重要任务结束时执行同样的完整工具链。当前不自动启动后台定时模型调用，避免未经用户配置就产生额外成本或静默修改。

### Memory 生命周期

Memory Note 除标题、正文和标签外，还带有 Workspace Scope、来源 Session/Trace、sourceRefs、创建/更新时间、访问次数、重要度、置顶、验证状态、置信度、过期时间、版本号和替代关系。内容发生实质变化时验证状态会重置为 unverified；来源不被丢弃。

主题知识页通过来源 Note ID 和 sourceRefs 追溯。过期且未置顶的 Note 可由 `memory_prune_expired` 归档，归档在 SQLite 事务中完成，并保存归档前后的版本快照；不会物理删除原始记忆。

### 上下文注入原则

每次会话只注入一个有硬上限的小型索引：先按置顶、重要度、验证状态和最近使用情况选择 Note，确保关键记忆不会被知识页正文挤出预算；知识页只注入较短的主题索引和来源 Note ID。更长的 Note、关系和知识页通过检索工具按需读取。对时效性信息、外部产品行为、模型价格、监管要求等，记忆只能提供线索，不能替代实时核验。

## 权限与安全

数据分析和记忆工具遵循现有 Tool Broker 权限：

- `none`：不向模型开放数据分析、记忆和 A2UI 工具。
- `assisted`：只开放工作区文件、DuckDB、文档提取、Memory 和 A2UI 等受限工具。
- `allow-all`：沿用当前 Allow-all 工具权限语义。

Expert 可分别勾选“数据分析”和“长期记忆”工具。没有把“可以读取附件”隐式扩展成“可以任意读取本机文件”，也没有让模型凭 SQL 直接访问任意路径。

A2UI Catalog 和 Finance Chart options 都有组件、数据量和配置约束；G6/X6 图数据有节点、边、形状和序列化大小限制。A2UI ActionMessage 必须引用当前 Task 已创建的 Surface，随后仍作为不可信用户交互进入 Agent，不会直接触发工具调用。所有数据写入和工具调用仍经过主进程 Tool Broker。文件内容、数据库行和模型输出均视为不可信输入。

## 当前限制与后续演进

1. 扫描 PDF 只提示无可提取文本，当前没有 OCR。
2. PDF 以文本和页码为主，尚未做跨页表格、图像、图表结构化抽取。
3. Word 解析提取正文，暂不保留复杂版面与修订痕迹。
4. 当前附件解析、DuckDB 导入和工具查询有明确大小、行数和返回行数上限。
5. 新会话使用 A2UI 1.0 的 Agent/Core/React SDK 和本地 Finance Catalog；旧会话保留 x-card v0.9。新组件必须同步扩展 Agent API schema 与 Renderer 实现。
6. Dreaming 已有 evidence manifest、复合游标、版本冲突检查、原子事务、实体/关系版本快照和最新 Run 回滚；Settings 提供 Memory/Dreaming 管理界面。整理由 Agent 在重要任务中执行或由用户手动触发，不是默认开启的后台定时模型服务。
7. 尚未实现 PDF OCR、PDF 表格重建、Embedding/向量记忆、跨 Workspace 全局记忆，以及独立的后台定时 Dreaming 服务。

## 主要实现文件

- `src/main/documents/document-service.ts`
- `src/main/analytics/duckdb-service.ts`
- `src/main/memory/agent-memory-store.ts`
- `src/main/agent-trace-store.ts`
- `src/shared/a2ui-finance-catalog.mts`
- `src/main/a2ui-service.mts`
- `src/renderer/a2ui/A2UIV1Canvas.tsx`
- `src/renderer/a2ui/finance-renderer-catalog.tsx`
- `src/renderer/components/AgentA2UICard.tsx`
- `src/renderer/components/FinancialChart.tsx`
- `src/renderer/components/FinanceChart.tsx`
- `src/renderer/components/KnowledgeGraph.tsx`
- `src/renderer/components/WorkflowDiagram.tsx`
- `tests/a2ui-v1.test.ts`
- `tests/agent-memory-store.test.ts`
- `src/renderer/MemoryManager.tsx`
