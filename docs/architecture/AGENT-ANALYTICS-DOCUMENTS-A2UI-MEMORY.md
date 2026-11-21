# Agent 数据分析、文件理解、A2UI 与长期记忆设计

## 目标与边界

本功能把桌面端从“能够操作浏览器和工作区文件的 Agent”扩展为本地数据分析与知识工作环境。核心仍然是现有 Electron 主进程、Copilot Agent、Tool Broker、IPC、Workspace 与 SQLite Session Store，不单独再建一套 Agent Runtime，也不引入云端数据处理依赖。

能力分为四部分：

1. 文档理解：PDF、DOC/DOCX、XLS/XLSX/XLSM，以及 CSV、TSV、JSON、TXT、Markdown。
2. 结构化分析：将表格导入本地 DuckDB，Agent 使用只读 SQL 做汇总、对比、趋势、风险敞口和异常分析。
3. 分析展示：Agent 通过 A2UI v0.9 描述界面，桌面端用 Ant Design X Card 和本地 Catalog 渲染原生卡片；金融图表使用 ECharts。
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
                      A2UI v0.9 Commands
                              |
                              v
                 A2UI Validator + Catalog
                              |
                              v
             Ant Design X Card + ECharts
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

## 金融图表与 A2UI

### 为什么使用 A2UI

Agent 不生成 HTML、JS 或 React 代码，而是输出 A2UI v0.9 JSON 命令。Renderer 只注册本地 Catalog 中的组件，不执行模型返回的源码。当前 Catalog 组件包括：

- 布局：Column、Row、Card、Divider
- 文本和指标：Text、Metric
- 数据展示：DataTable
- 金融图表：FinancialChart
- 交互：Button

FinancialChart 接受 JSON ECharts option，当前按需注册折线、柱状、K 线、饼图、散点图、Tooltip、Legend、DataZoom 等模块。图表随容器尺寸变化；高度和配置大小均有限制。任意 formatter 和额外 CSS 注入字段会在渲染前移除，Tooltip 固定为 richText。

A2UI 当前使用 `createSurface`、`updateComponents`、`updateDataModel` 和 `deleteSurface`。命令必须使用当前应用 Catalog ID；组件、动作和数据路径先经主进程白名单校验，再交给 X Card 渲染。按钮操作通过 `onAction` 回到 Agent 对话。

当前实现以一批完整命令提交为主；X Card 支持增量命令队列，后续如需要再把 Agent 输出改为渐进式 UI 更新。

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

### Dreaming 工作方式

当前提供显式 Agent 工具：

- `memory_search`：检索 Note。
- `memory_search_history`：检索现有 Transcript。
- `memory_save`：记录值得跨会话保留的经验。
- `memory_review`：依据证据更新验证状态。
- `memory_publish_knowledge`：将 Note 整理成主题知识页。
- `memory_dreaming`：在重要任务后回看历史，晋级高价值 Note、整理知识页、取消或归档重复/过时内容，并记录整理摘要。

Dreaming 不应只记录失败。对该 Workspace 中有长期价值的成功路径、反复出现的业务规则、用户明确偏好、数据口径和已确认决策，也应考虑沉淀。

当前 Dreaming 是 Agent 在任务中主动调用的受控工具，不是后台定时任务，也不承诺在每次对话结束时自动执行。这样可以避免不可控的后台模型成本和静默修改。后续可以加“空闲时整理”调度，但应先具备可审阅的变更记录和撤销机制。

### 上下文注入原则

每次会话只注入一个约 9 KB 的小型索引：优先置顶和已验证内容，同时保留未验证/争议标记与来源 ID。更长的 Note 和知识页通过检索工具按需读取。对时效性信息、外部产品行为、模型价格、监管要求等，记忆只能提供线索，不能替代实时核验。

## 权限与安全

数据分析和记忆工具遵循现有 Tool Broker 权限：

- `none`：不向模型开放数据分析、记忆和 A2UI 工具。
- `assisted`：只开放工作区文件、DuckDB、文档提取、Memory 和 A2UI 等受限工具。
- `allow-all`：沿用当前 Allow-all 工具权限语义。

Expert 可分别勾选“数据分析”和“长期记忆”工具。没有把“可以读取附件”隐式扩展成“可以任意读取本机文件”，也没有让模型凭 SQL 直接访问任意路径。

A2UI Catalog 和 ECharts option 都有大小、组件和字段约束；所有数据写入和工具调用仍经过主进程 Tool Broker。文件内容、数据库行和模型输出均视为不可信输入。

## 当前限制与后续演进

1. 扫描 PDF 只提示无可提取文本，当前没有 OCR。
2. PDF 以文本和页码为主，尚未做跨页表格、图像、图表结构化抽取。
3. Word 解析提取正文，暂不保留复杂版面与修订痕迹。
4. 当前附件解析、DuckDB 导入和工具查询有明确大小、行数和返回行数上限。
5. A2UI 使用自有白名单 Catalog，不直接下载远程组件；当前支持的图表种类按需注册，后续增加新图表类型需要同时扩展 Catalog 和 ECharts 注册项。
6. Memory Dreaming 目前是显式工具，不是自动后台调度；Memory 仍需基于来源进行人工或 Agent 复核。
7. 尚未实现 PDF OCR、PDF 表格重建、Embedding/向量记忆和跨 Workspace 全局记忆。

## 主要实现文件

- `src/main/documents/document-service.ts`
- `src/main/analytics/duckdb-service.ts`
- `src/main/memory/agent-memory-store.ts`
- `src/main/agent-trace-store.ts`
- `src/shared/a2ui.ts`
- `src/renderer/components/AgentA2UICard.tsx`
- `src/renderer/components/FinancialChart.tsx`
