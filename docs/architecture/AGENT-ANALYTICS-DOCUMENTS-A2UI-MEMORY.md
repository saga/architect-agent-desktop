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

同名数据集重导入采用单个 DuckDB 事务：先建表、分批写入，所有批次成功后才提交；任意批次失败即回滚，旧表保持完整，不暴露半成品。

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

检索默认使用 SQLite FTS5/BM25 与 LIKE 子串回退。启用 Settings → Agent → Memory 语义检索后，额外使用本机 Ollama `/api/embed` 建立向量索引，与词法召回做混合排序；Ollama 请求只允许 `localhost`、`127.0.0.1` 或 `::1`，禁止远程主机。设置页提供本机连接与模型测试，会验证服务可达和返回向量维度。若 Ollama 响应声明的模型与请求模型不一致，系统拒绝写入，避免将不同向量空间混合。索引保存在同一个本地 SQLite 数据库，向量记录绑定 Note 的 content hash；Note 内容变化、归档或过期后旧向量不会被召回。Dreaming 批量提交后会自动补齐当前模型的缺失索引，手动重建仍可用于全量修复。更换模型需要重新建立索引。混合召回过滤低相似度的纯语义候选，词法命中仍保留。Ollama 不可用时自动回退 FTS5/中文短语检索，不会阻断 Memory Search。Embedding 默认关闭，应用不负责下载模型，也不会把 Personal Memory 或项目内容发送到第三方 Embedding 服务。

### Personal Memory 与 Workspace Memory 的隔离边界

Memory 分为 Personal 和 Workspace 两层。Personal Memory 只保存用户明确要求跨项目保留的通用偏好、工作方式和用户意图；Workspace Memory 保存项目事实、数据口径、项目流程和工作产物。Workspace Agent 的上下文注入与 memory_search 会同时读取当前 Workspace 和 Personal Memory，并明确区分来源；其他 Workspace 的项目 Note 不会进入当前结果。Personal Task 只读取 Personal scope。

Personal scope 的写入边界由 SQLite 存储层强制执行，而不只依赖 Agent Prompt：只允许 `user_preference` 与 `user_intent` 两类 Note；`decision`、`project_fact`、`workflow_pattern`、`external_fact` 和 `unknown` 必须留在 Workspace。Personal scope 不允许发布知识页、建立 Note 关系或做 Note 替代关系。Personal Task 的 Agent 工具只读取安全分类的 Notes，不读取 Personal 知识页和关系。旧版本中已经误放入 Personal 的项目型 Note 仍会在 Memory Manager 中显示，供用户检查和归档，但会从 Agent 的列表、搜索、来源读取、上下文注入和 Embedding 索引中排除；升级时会删除这些旧记录对应的 Personal 向量。Personal 和 Workspace 的自动 Dreaming 也使用不同提示约束，存储层会再次验证写入类型。 Workspace Agent 只能读取共享 Personal Note 的简短内容，不能打开该 Note 背后的 Personal Transcript，也不会收到其 sourceId；这样避免一条通用偏好的原始对话中夹带其他项目内容。Personal Task 仍可在该 Note 明确引用时追溯自己的来源。旧版外部事实若曾把同一注册域名下的子域名当作多个独立来源，读取时会将来源状态纠正，并把相应的历史 `validated` 降为 `unverified`。

写入边界比读取边界更严格：Workspace Agent 不能把项目内容直接写入 Personal scope。要保存跨项目通用信息，必须切换到 Personal Task；Personal scope 的证据快照也只有在被活动 Personal Note 引用时，才能由 Workspace Agent 的 memory_read_source 读取。系统不自动把项目 Note 提升为 Personal Note，避免项目机密或业务数据跨 Workspace 扩散。

### Note 类型与验证证据策略

每个 Note 都有明确 claimType：user_preference、user_intent、decision、project_fact、workflow_pattern、external_fact 或 unknown。unknown 不能被标记为 validated。验证状态不是 Agent 自报字段，SQLite 存储层会读取 Note 引用的真实 Transcript source kind，并保存一份可审计的 validationEvidence：

- 用户偏好、用户意图和决定：至少有一条 user Transcript 原话。助手总结、工具输出、UI 交互或错误消息不能替代用户表达。
- 项目事实和工作模式：至少两个独立 Session，并同时包含 direct_user 与 tool_observation 来源。重复引用同一 Session 的多条消息不构成独立交叉验证。
- 外部事实：Agent 不能通过 Dreaming 或普通 Note 操作将其标记为 validated。必须先用 `memory_record_external_sources` 登记至少两个不同注册域名的 HTTPS 来源，且域名确实出现在当前 Workspace 已保存 tool evidence 中；同一注册域名下的不同子域名不算独立来源。随后用户需要在 Memory Manager 中逐一打开并核对链接，再显式确认“我已核对来源”。确认记录会保存 sourceRef、URL、域名、发布机构、日期、Note 版本和人工确认策略。该状态表示用户声明已核对来源，不是系统自动证明网页内容真实。
- assistant_generated、error_report 和 user_interaction 不会单独使事实满足验证策略。

一般 Note 的验证门槛核验来源类型和会话独立性，不是对工具来源或内容真实性的自动认证。external_fact 另走人工来源核验流程，且人工确认本身仍是一项用户声明；投资、合规等重要决策仍须回到监管机构、发行人或其他原始来源核对。qualityScore 是记忆质量评估，不能代替事实验证。旧版本中没有验证证据档案的 validated 标记会在新版本读取时按 unverified 展示，直到重新完成证据复核。

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

增量证据现在以 Session SQLite 的不可变 `session_message_revisions` 修订序号为主游标。每次新增或修改消息都会记录新的 revision、修改时间和 changeType；同一消息在一个批次内多次修订时只取最新快照。每条消息最多保留最近 12 个修订快照，已被 Dreaming 固化的旧证据则保留在独立的 Memory evidence 表中。旧数据库首次升级时按旧的 `createdAt + sessionId + messageId` 游标过滤 baseline，避免重新整理已经处理过的历史消息。后续即使修改数周前的消息，也会进入新的证据批次。游标只在 Transcript Run 成功提交时前移，质量复查 Run 不会移动该游标。

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

**质量复查**

质量复查是独立的 `quality_review` Run，不与新 Transcript 整理混在同一个游标事务里。系统筛选超过 30 天未复查、仍处于活动状态且具有来源引用的 Note；`memory_quality_review_prepare` 固定历史证据，`memory_quality_review_list({runId})` 将候选 Note 映射到本次 Run 的 source ID。Agent 必须使用 `qualityReviewSourceRefs`，不能把旧 Run 的 sourceRef 当作本次提交证据。复查通过 `review_note` 记录 0–1 的 `qualityScore`、confidence 和验证状态；质量分数考虑来源可靠性、直接性、清晰程度、时效性和交叉印证。质量 Run 只接受带质量分数的 review_note，不允许顺手创建、归档或发布其他实体；空候选应 abandon，而不是提交空复查事务。

质量分数是模型基于已固定证据作出的复核判断，不是外部事实验证器或统计置信区间。来源不足时保持 unverified；旧 Note 不能仅凭自身内容完成自我验证。external_fact 的人工核对由独立 UI 操作完成，Agent 不能代替用户确认。

**Agent 的整理策略与调度**

对重要任务，系统提示要求 Agent 主动执行 prepare → evidence review → commit。整理目标不局限于失败记录，还包括成功流程、稳定的用户偏好、项目约定、业务定义、数据口径、重复出现的错误和已解决问题。模型必须区分事实、推测、冲突和时效性信息；证据不足时保持 unverified，矛盾并存时记录 contradicts 或 disputed，不为了减少 Note 数量而删除唯一知识。对重要、高风险或可能变化的旧 Note，Agent 应通过 `memory_read_source` 按 `sourceId` 读取历史证据快照，并结合 `memory_search_history` 搜索更早 Transcript；不能只凭 Note 自身内容完成自我验证。

Settings → Memory & Dreaming 提供 Notes、知识页、关系、Run 审计和质量分数管理，并允许手动启动整理、单独复查质量、继续处理已有 prepared Run、置顶/取消置顶 Note、归档 Note、放弃 prepared Run 或回滚最近一次提交。自动 Dreaming 可在 Personal scope 单独启用，也可为每个 Workspace 单独启用，周期为 6 小时至 7 天。调度复用主进程现有的 15 秒 Schedule 检查循环，按 scope 串行执行 Transcript 整理、到期质量复查和过期 Note 清理。每次调度先通过本地 SQLite/Transcript 查询预检；没有新 revision、到期质量复查、过期 Note 或待恢复 Run 时直接跳过，不启动模型调用。实际运行失败采用退避重试，运行结束检查是否残留 prepared Run，并写入 Trace。

自动调度默认关闭，只在桌面应用运行时工作。它不会扩大现有工具权限：全局工具权限和所选 Expert 必须至少允许 assisted，且 Expert 必须开放完整长期记忆工具组。Personal schedule 使用 Personal Task；Workspace schedule 只匹配同一路径的 Task，并在执行前验证 Workspace 路径仍然存在且是 canonical directory，避免把项目记忆误写到 Personal Memory。

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

A2UI Catalog 和 Finance Chart options 都有组件、数据量和配置约束；G6/X6 使用独立纯函数校验图数据：G6 拒绝重复节点/边 ID、畸形边和悬空端点，X6 限制形状、节点几何与端点，并递归拒绝脚本 URL、HTML、事件处理器和可执行值。A2UI ActionMessage 必须引用当前 Task 已创建的 Surface，随后仍作为不可信用户交互进入 Agent，不会直接触发工具调用。所有数据写入和工具调用仍经过主进程 Tool Broker。文件内容、数据库行和模型输出均视为不可信输入。

## 当前限制与后续演进

1. 扫描 PDF 只提示无可提取文本，当前没有 OCR。
2. PDF 以文本和页码为主，尚未做跨页表格、图像、图表结构化抽取。
3. Word 解析提取正文，暂不保留复杂版面与修订痕迹。
4. 当前附件解析、DuckDB 导入和工具查询有明确大小、行数和返回行数上限。
5. 新会话使用 A2UI 1.0 的 Agent/Core/React SDK 和本地 Finance Catalog；旧会话保留 x-card v0.9。新组件必须同步扩展 Agent API schema 与 Renderer 实现。
6. Dreaming 现有 evidence manifest、不可变 Transcript revision、复合兼容游标、版本冲突检查、原子事务、实体/关系版本快照和最新 Run 回滚。旧 Session 数据会在首次打开时建立 baseline 修订记录；旧的已提交 Memory cursor 会继续作为 baseline 过滤依据。
7. Memory Notes 有独立的质量复查 Run、来源映射、质量分数与最近复查时间；质量复查不推进 Transcript cursor，并支持审计和回滚。质量分数仍由模型根据来源证据判断，并非独立事实校验器。
8. Personal 与 Workspace 自动 Dreaming 已接入现有主进程 Schedule 循环，默认关闭、按 Memory scope 分别保存周期、仅在桌面应用运行时执行，并受全局与 Expert 工具权限约束；失败会退避重试，残留 prepared Run 不会被报告为成功。
9. 尚未实现 PDF OCR 与跨页 PDF 表格重建。Transcript revision 按每条消息保留最近 12 个快照；长期大量新增消息仍会自然增加本地 SQLite 文件体积，尚未实现跨 Workspace 的历史归档工具。
10. Ollama Embedding 需要用户自行安装、运行和下载模型；当前没有内置模型安装器或索引空间压缩。设置页提供手动连接/模型检查，但不持续后台监控服务健康。语义向量检索默认关闭，无法连接本机服务时自动退回词法召回。
11. `validated`、confidence 和 qualityScore 仍不等同于独立真值证明。普通 Note 通过来源类型与 Session 数验证；external_fact 需要用户人工确认多个来源，但应用无法保证用户确实完整阅读或理解了来源。
12. 目前没有独立的 Memory Goal / Policy 配置；可以通过 Expert Prompt 提供领域目标，但还不能为不同 Workspace 设置结构化的记忆采集、保留和验证规则。知识页也没有完整的页面间链接、反向链接和孤儿页面自动检查。

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
