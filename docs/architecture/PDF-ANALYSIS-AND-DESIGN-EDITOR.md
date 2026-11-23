# PDF 分析与可视化设计编辑能力设计

> 状态：方案设计（尚未实现）
>
> 目标仓库：saga/architect-agent-desktop
>
> 文档定位：桌面 Agent 的一项本地文档能力，不是独立 PDF 产品，也不新增一套 Agent Runtime。

## 1. 目标与设计结论

将 PDF 从当前“可作为附件提取文本”的文件类型，扩展为桌面 Agent 能够理解、分析、可视化检查和受控修改的文档对象。

用户可以在 Agent 对话中要求：

- 分析一份 PDF，按页总结内容、结构、重点和证据位置。
- 识别标题、段落、表格、图片、图表、页眉页脚和阅读顺序。
- 查看某一页的布局和元素边界，定位文字或图表。
- 修改文字、替换图片、增加文字/形状/标注，或调整元素位置。
- 预览修改结果，检查排版变化，再导出一份新的 PDF。

**核心设计结论：**

1. 复用现有 Electron Main Process、Document Service、Agent Tool Broker、Task/Workspace 授权、SQLite Session 和文件选择器；不新增 Agent Runtime。
2. 复用项目已经安装的 pdfjs-dist 完成 PDF 渲染与文本层提取，不再引入第二套 PDF Viewer。
3. 建立独立于 PDF 文件格式的 PdfDocumentModel / Design Model。PDF 是输入和导出格式，模型才是 Agent 和编辑器共同操作的对象。
4. PDF 原件默认不可变。所有修改先成为带版本号的 Edit Operations，用户在 PDF Workbench 中检查预览，再导出到用户选择的位置。
5. 明确区分“视觉覆盖修改”和“PDF 原生对象修改”。在页面上盖住旧文字再画新文字，不代表旧文字已从 PDF 内容流中删除，更不等于安全脱敏。
6. 先把 PDF 分析和原版布局下的有限编辑做可靠，再逐步增加原生对象重写、设计元素重建和 OCR/Layout 模型。不能把完整 Canva 式重建作为第一阶段承诺。

## 2. 当前项目基础与缺口

当前仓库已经具备以下基础：

- Electron 主进程统一管理 Agent、文件选择、IPC 和本地数据。
- Copilot SDK / CodeBuddy 通过现有 Agent Provider 接入；新能力应继续通过现有 Tool Broker 提供。
- 文件路径从系统文件选择器或已授权 Workspace 文件产生，Task 维度维护附件授权集合。
- 现有 Document Service 已支持 PDF、DOC/DOCX、Excel、CSV/TSV、JSON、TXT/Markdown 等文件。
- PDF 当前通过 pdfjs-dist 逐页提取文本；扫描版 PDF 因没有文本层而提示可能是扫描件，目前不执行 OCR，也没有版面级元素模型。
- 当前结构化表格可以进入 Workspace 隔离的 DuckDB，并由只读 SQL 工具查询。
- Renderer 使用 React、Ant Design / Ant Design X；PDF 不应暴露 Electron 或 Node.js 原始 API。
- 项目已经使用 A2UI 1.0 展示结构化 Agent 输出，也有独立的 Finance Catalog 和图形组件。

因此，PDF 能力应扩展现有文档链路，不应新建一个平行的“PDF Agent”、第二个文件授权体系或独立会话系统。

### 2.1 主要缺口

| 领域 | 当前状态 | 需要补足 |
|---|---|---|
| 文本解析 | PDF.js 逐页文本提取 | 字符/文本块坐标、字体样式、文本变换和稳定定位 |
| 页面渲染 | 已有 PDF.js 依赖 | 页面工作台、缩放、缩略图、选区和叠加层 |
| 版面理解 | 尚无完整 Layout 模型 | 区域识别、文本聚合、元素类型、阅读顺序和分组 |
| 扫描件 | 无 OCR | 可插拔 OCR / Layout Provider，并返回置信度 |
| 图片和矢量 | 尚未形成统一对象模型 | 识别 PDF 图像对象、路径、线条、绘制顺序 |
| 修改 | 无 PDF 编辑器 | Edit Operations、预览、撤销/重做和导出 |
| 导出验证 | 尚无编辑导出链路 | 页面渲染差异、文本校验、原件保护和格式警告 |

## 3. 产品形态：Agent 能力 + PDF Workbench

PDF 分析与修改由两个配合的入口组成。

### 3.1 Agent 对话入口

用户在当前 Task 中选择/授权 PDF 后，可以直接通过自然语言要求分析或修改。

例如：

- “分析这份报告的目录、章节、表格和图表，按页列出重点。”
- “检查第 12 页的标题和图表注释。”
- “把第 2 页标题改成 ‘Investment Overview’，保持原有字号和位置。”
- “给第 5 页增加一段风险提示，放在表格下方。”
- “把这几处修改预览一下，检查是否有文字溢出。”

Agent 负责理解意图、分析文档、提出操作计划和调用受控工具；不能直接操作 PDF 二进制，也不能生成任意脚本来修改文件。

### 3.2 PDF Workbench

PDF Workbench 是桌面应用内的专用文档工作区，不是一个外部网站，也不是单独的 Agent。

建议入口：

- 在 Agent 附件卡片或 Workspace PDF 文件的上下文菜单中选择“在 PDF 工作台打开”。
- Agent 调用 PDF 工具后，可以请求在当前 Task 的右侧工作区打开对应文档。
- Pure Agent 模式的右侧结果区增加 PDF Workbench 内容类型；不改变现有三栏结构，不另开一套会话。
- Sidepanel 模式可从 Agent 的文档卡片打开同一个内部 Workbench 视图。

建议工作台布局：

| 区域 | 内容 |
|---|---|
| 左侧 | 页面缩略图、页码、页面跳转 |
| 中央 | PDF 页面渲染画布、选区、元素边界和编辑叠加层 |
| 右侧 | 当前元素属性、文字/字体/颜色/尺寸、布局信息和修改记录 |
| 顶部工具栏 | 选择、文字、图片、形状/标注、撤销/重做、缩放、预览、导出 |

不需要在第一版中实现完整的 Canva 工具栏、模板市场或自由画布。先把页面编辑和属性检查做好。

## 4. 总体架构

    Agent Task / User-selected PDF
                 |
                 v
      Existing Attachment Authorization
      - system file picker / Workspace
      - Task-scoped authorized file set
      - realpath + file fingerprint
                 |
                 v
           Existing Tool Broker
                 |
           +-----+---------------------------+
           |                                 |
           v                                 v
     Existing Document Service          PDF Workbench IPC
           |                                 |
           +---------------+-----------------+
                           |
                           v
                    PdfDocumentService
                           |
            +--------------+------------------+
            |              |                  |
            v              v                  v
       PDF.js Adapter   Layout Engine     Export Adapter
       render/text      native geometry   PDF writer
       extraction       + optional OCR    + validation
            |              |                  |
            +--------------+------------------+
                           |
                           v
                    PdfDocumentModel
              - source fingerprint / pages
              - native elements / inferred regions
              - editable capability / provenance
              - edit operations / revisions
                           |
                 +---------+---------+
                 |                   |
                 v                   v
            Agent Tools          PDF Workbench
            inspect/layout       render/select/edit
            stage edits          preview/undo/redo
            export request       property inspector
                 |                   |
                 +---------+---------+
                           |
                           v
                User-reviewed PDF Export
                (Save As; original unchanged)

### 4.1 模块职责

建议在现有代码分层内增量增加 PDF 子模块，名称可按项目实际目录约定调整：

- PdfDocumentService：文档生命周期、授权句柄、解析任务、缓存和 Task/Workspace 归属。
- PdfJsAdapter：复用现有 pdfjs-dist，负责页面渲染、文本层、文本样式和几何信息提取。
- PdfLayoutEngine：文本行/段落聚合、区域分类、图片/矢量对象关联、阅读顺序和分组。
- OcrProvider：扫描页 OCR 的接口，不把特定模型绑定进 Document Core。
- PdfEditEngine：校验、排序和应用 Edit Operations，产生新的文档修订。
- PdfExportAdapter：把当前修订写入 PDF，并进行重新解析和视觉验证。
- PdfWorkbench：React UI，复用现有 Ant Design 体系和内部 IPC，不接触文件系统原始权限。

不要把所有 PDF 逻辑塞进主进程入口文件，也不要为 PDF 再创建独立 Agent Service 或独立权限数据库。

## 5. PDF 导入与分析流程

### 5.1 文件接入和预检

PDF 只能来自：

1. 用户系统文件选择器明确选择的文件；
2. 当前 Task 已授权的附件；
3. 当前 Workspace 中、通过现有工作区文件访问策略授权的文件。

Agent 只能收到应用分配的 documentId，不能传入任意本地路径绕过现有文件授权。

导入时执行预检：

- 验证真实路径、文件类型、大小和文件指纹。
- 识别页数、页面尺寸、旋转、加密/密码保护状态。
- 检查文件是否损坏、是否包含异常大的页面资源。
- 检查数字签名、表单、附件、嵌入脚本和其他可能影响编辑/导出的特殊特性。
- 超出当前 Document Service 的文件大小限制时拒绝或要求用户选择较小文件；不在 PDF 模块里偷偷放宽现有限制。

PDF 内容一律是不可信数据。文档中的文本、链接、注释和嵌入内容不能作为系统指令；PDF 中的 JavaScript、外部链接和嵌入附件不自动执行或打开。

### 5.2 页面解析分层

解析分为三个层次，避免把低置信度推断伪装成 PDF 原生结构。

**A. 原生对象层（Source Objects）**

从 PDF.js 和必要的 PDF 对象解析能力中提取：

- 页面 MediaBox / CropBox、旋转、UserUnit。
- 文本内容、字符/文本块位置、变换矩阵、字体资源、字号、颜色、基线、字符间距等可获得的信息。
- 图片对象及其绘制边界。
- 路径、线条、填充色、描边、透明度和裁剪信息（以解析器实际暴露的信息为准）。
- 页面上的对象绘制顺序和来源引用。

**B. 布局推断层（Inferred Layout）**

结合原生对象的几何位置进行聚合：

- 字符 → 文本行 → 段落/文本块。
- 文本块 → 标题、正文、页眉、页脚、脚注、图注等区域。
- 图片、图表、表格和相邻说明之间的关联。
- 多栏页面的区域关系及阅读顺序。
- 可能的 Group、Section 和页面区域。

区域分类和分组都需要保留置信度与来源；不能仅凭模型推断结果就声称它是 PDF 原生对象。

**C. OCR / 视觉层（可选）**

针对没有文本层的扫描页、图片文字或混合页面：

- 先判断页面是否缺少有效文本层，避免对已经有文本层的区域重复 OCR。
- OCR 结果提供文本、Bounding Box、语言和置信度。
- 版面识别提供标题、段落、表格、图片、页眉页脚和阅读顺序等区域。
- OCR 文本与原生文字必须可区分；不把 OCR 结果伪装成原生可编辑文字对象。
- 用户可以检查或纠正 OCR 后，再将其纳入编辑模型。

### 5.3 文档类型和能力差异

| PDF 类型 | 分析能力 | 编辑能力与限制 |
|---|---|---|
| Office 导出的文字型 PDF | 原生文字提取、坐标、字体和区域聚合 | 可定位文字；原生替换能力取决于导出引擎和字体资源 |
| PPT/设计工具导出的 PDF | 文字、图片、路径和图形对象分析 | 可逐步建立独立设计对象；复杂分组需要推断 |
| 扫描 PDF | OCR + 页面/区域识别 | 识别结果是 OCR 层；不能假装原 PDF 已有可编辑文字 |
| 混合 PDF | 原生文本与 OCR 互补 | 对每个元素标明来源和可编辑方式 |
| 扁平化/页面截图 PDF | 页面级视觉分析 | 默认只能覆盖或重建可识别元素，不能保证完整还原 |
| 加密、签名、复杂表单 PDF | 先报告兼容性和限制 | 需要密码/特殊处理；编辑可能使数字签名失效 |

### 5.4 分析结果要有页码和位置证据

Agent 输出的分析不应只给一段摘要。每个重要结论尽可能包含：

- 文档页码；
- 对应的区域或元素 ID；
- 页面 Bounding Box；
- 来源类型（原生文本、OCR、布局推断或用户输入）；
- 置信度/解析警告。

例如：“第 8 页的表格显示行业敞口”应能定位到第 8 页对应的 Table Region，而不是只保留一句没有位置依据的模型摘要。

PDF 表格如果达到可用的行列结构，可以沿用现有 DuckDB 导入能力，但要经过结构预览和确认，保留页码与单元格位置来源。不要把普通文本按空格切分后就认定为表格。

## 6. 统一文档模型：PdfDocumentModel

PDF 不应该成为编辑器的内部状态。内部使用与 PDF 文件格式解耦的页面/元素模型；未来 DOCX、PPTX、SVG 等格式可以复用通用部分，但本阶段不扩大到通用多格式编辑器。

建议模型至少包含：

- Document：文档 ID、模型版本、来源指纹、页列表、当前修订号。
- Page：页面尺寸、裁剪框、旋转、背景和元素顺序。
- Region：页面语义区域，例如 Header、Body、Column、Footer、Figure、Table。
- Element：Text、Image、Vector、Shape、Table、Annotation、Group。
- SourceRef：原始 PDF 来源定位，绑定来源文件指纹，不能单独依赖不稳定的 PDF 对象编号。
- EditOperation：修改意图和参数，不直接保存整页替换后的 PDF 二进制。
- Revision：修订号、操作列表、作者类型（user/agent）、时间、基于的版本和校验结果。

元素至少需要以下字段：

| 字段 | 含义 |
|---|---|
| id | 文档模型中的稳定元素 ID |
| pageIndex | 所属页面 |
| type | text / image / vector / shape / table / annotation / group |
| origin | native-pdf / ocr / inferred / user-created |
| bbox | 页面坐标系中的 x、y、width、height |
| rotation / zIndex | 旋转和绘制层级 |
| sourceRef | 原始 PDF 来源定位 |
| confidence | OCR 或布局推断置信度 |
| editCapability | read-only / overlay / object-rewrite / reconstructed |
| groupId | 可选的父分组 |
| properties | 按元素类型定义的强类型属性 |

正式实现需要为 Text、Image、Vector、Table 等元素定义独立的强类型属性，避免用无限制的通用对象作为最终数据模型。

### 6.1 坐标约定

统一使用页面坐标系，原点位于页面左上角，单位为 PDF Point（1/72 inch）。所有 Bounding Box、文字位置、拖动/缩放和 Edit Operations 都使用这个坐标系。

PDF 原生坐标通常采用左下原点，并可能受到 CropBox、页面旋转和 UserUnit 影响。转换逻辑集中在 PDF Adapter，不允许 UI、Agent Prompt 和不同工具各自做坐标换算。

保存页面实际尺寸和变换矩阵；处理旋转页面时，屏幕坐标与 PDF 坐标之间必须可逆。缩放只影响视图变换，不改变模型中的几何值。

### 6.2 原生信息与推断信息分离

同一个文本框可能由多个原始 PDF Text Runs 聚合而来；也可能是 OCR 或布局模型识别出来的区域。

因此：

- 原始对象信息只读保留，作为来源和导出依据。
- 推断出的 Region / Group 可以被人工修正。
- Agent 创建的对象必须标记为 user-created。
- UI 显示每个元素的可编辑能力；不可编辑元素不提供误导性的编辑入口。
- 源 PDF 指纹变化后，旧 SourceRef 不能直接套用到新文件；必须重新解析或要求用户重新关联。

## 7. 修改模型与编辑模式

编辑能力拆成两种模式，内部共用 Document Model 和 Edit Operations。

### 7.1 原版布局模式（Preserve Layout）

目标是尽量保留原 PDF 外观，仅在指定区域做有限修改：

- 新增文字、形状、标注和图片。
- 调整新增对象的位置、尺寸和样式。
- 对支持的原生 PDF 元素做对象级修改。
- 对暂不支持对象级修改的文字，可提供受限的“视觉覆盖替换”：遮盖旧区域并重新绘制文字。

视觉覆盖替换必须明确标记为 overlay，并告知用户：

- 原文字可能仍存在于 PDF 内容流中；
- 搜索、复制、辅助技术或底层对象提取仍可能看到原文；
- 背景不是纯色时，遮盖效果可能无法完全复原；
- 这不是安全删除或 Redaction。

对敏感信息删除不能使用普通覆盖操作冒充真正 Redaction。安全 Redaction 必须从 PDF 内容对象中移除对应内容，并验证导出文件无法再提取被删除的文本/图像信息；在真正实现之前，界面不提供“安全脱敏已完成”的承诺。

### 7.2 设计重建模式（Editable Design）

将页面上的原生元素、图片和矢量图形转换为可独立选择、移动、缩放、分组和重新排版的设计对象。

目标包括：

- 独立选择和编辑文字、图片、矢量图形。
- 组合/拆分 Group，调整层级和对齐。
- 修改字体、字号、颜色、间距和文本框。
- 替换图片并调整裁剪。
- 对标题、正文、图注等相关区域进行布局调整。

这不是对任意 PDF 都能完整恢复原始设计源文件。字体子集、复杂裁剪、透明度、渐变、复杂路径和扁平化图片会影响恢复质量。对无法还原的元素，保留为只读背景或明确提示需要重建，不应生成看似可编辑、实际丢失样式的伪对象。

### 7.3 Edit Operations

Agent 和 UI 使用同一组有版本约束的操作：

- addText
- replaceText
- addImage
- replaceImage
- addShape
- addAnnotation
- moveElement
- resizeElement
- setTextStyle
- setElementStyle
- deleteElement
- groupElements
- ungroupElements
- reorderElements

每个操作包含 documentId、baseRevision、目标元素/页面、参数和来源说明。应用前执行 schema 校验、目标存在性校验、坐标范围校验、字体/图像资源校验和冲突检查。若文档修订号与 Agent 读取时不同，拒绝静默覆盖并要求刷新。

不要让 Agent 传任意 PDF 命令、JavaScript、Python 或二进制补丁。编辑操作是白名单 API。

### 7.4 文字排版约束

文字替换不能只把字符串写回文件。需要检查：

- 原文本框大小与基线；
- 字体是否可用，是否嵌入，是否为子集字体；
- 字符宽度、字距、行高、换行和方向；
- 中日韩文字、混排、复杂脚本和缺失字形；
- 文本变长后的溢出和与相邻元素重叠。

文字替换策略应有显式结果：原尺寸适配、允许换行、缩小字号、扩展文本框或需要用户处理。Agent 不能为了“看起来成功”自动缩小到不可读字号，也不能静默移动其他原始元素。

## 8. PDF 引擎与开源项目选型

### 8.1 基础路径

| 层次 | 建议 | 说明 |
|---|---|---|
| 渲染与文本层 | 现有 pdfjs-dist | 已是项目依赖，继续作为默认 Viewer / 文本提取器 |
| 页面交互 | PDF.js Canvas + SVG Overlay + DOM Text Editor | 复用现有 React / Ant Design，第一阶段不急于引入大型 Canvas 框架 |
| 叠加对象与基础导出 | 评估 pdf-lib | 可用于新增文字、图片、形状、页面操作和导出；不等同于完整原生对象编辑 |
| 原生对象改写 | 评估 PDFium | 通过 Adapter 隔离平台绑定；先做 macOS / Windows 打包与对象修改 POC |
| OCR / Layout | Provider 接口，按 POC 选型 | 不把大型 Python/PyTorch 模型设为桌面端必装依赖 |

### 8.2 参考项目

- [PDF.js](https://github.com/mozilla/pdf.js)：继续作为当前项目的页面渲染和文本提取基础。
- [PDFZero](https://github.com/bevinkatti/PdfZero)：研究 PDF.js 提取 Text Run → DOM Overlay 编辑 → Layout Fit → 导出规划的分层方式。其当前方案属于 Overlay/Repair 路线，不应当等同于原生 PDF 对象编辑。
- [Folio](https://github.com/doktorigi/folio)：研究本地浏览器 PDF 编辑、文字覆盖、OCR 和 Redaction 的交互组织方式；实际 Redaction 语义需要以导出结果和源码实现为准。
- [Surya](https://github.com/datalab-to/surya)：研究 OCR、Layout Detection、Reading Order 和表格区域识别的 JSON 结果。其模型和运行依赖较重，先作为可选 Provider 的 POC 对象，不直接打入桌面安装包。
- [pdf-lib](https://github.com/Hopding/pdf-lib)：适合评估基础 PDF 写入、叠加对象和导出。
- [PDFium](https://github.com/chromium/pdfium)：评估原生对象检查/修改的可行性、跨平台打包和 API 覆盖。
- [MuPDF](https://github.com/ArtifexSoftware/mupdf)：作为 PDFium 的备选技术评估；必须先完成 AGPL / 商业授权分析，再决定是否采用。

### 8.3 不建议当前直接采用的做法

- 不把 Docling/Marker 当成设计对象模型：它们主要解决文档理解/转换，不负责保真设计编辑。
- 不把 OCR 结果直接当成原始文字：OCR 只是识别层，必须保留来源和置信度。
- 不在第一阶段同时集成 PDFium、MuPDF、PDFium WASM、多个 OCR 模型和多个 Canvas 编辑器。
- 不让 PDF 编辑依赖外部云端转换 API；文件解析和编辑默认在本机完成。
- 不自行实现完整 PDF 规范解析器。

### 8.4 明确的技术选型决策顺序

先做一个小型 PDF Engine POC，对比：

1. PDF.js + pdf-lib 能否满足新增对象、简单文字覆盖、页面操作和稳定导出。
2. PDFium 是否能在当前 Electron 支持的 macOS 和 Windows 打包目标上稳定工作，是否能可靠读取/删除/修改目标文本对象并保存。
3. 原生对象修改后是否保留字体、透明度、裁剪、链接、表单和页面资源。
4. Surya 或其他 OCR/Layout Provider 对中文、日文、英文混排及金融报告的效果、模型大小和离线运行成本。
5. MuPDF 只有在许可证、打包和维护成本可接受时才作为备选。

POC 通过之前，不把原生对象编辑能力写成已经具备的功能。

## 9. Agent 工具与权限设计

所有 PDF 工具继续注册到当前 Agent Tool Broker，由现有全局工具权限和 Expert 权限上限控制；不另建 PDF 专用安全体系。Copilot SDK 和 CodeBuddy 都复用相同的应用内工具实现和 schema。

建议的工具契约：

| 工具 | 用途 | 主要输入 | 结果 |
|---|---|---|---|
| pdf_inspect | 文档概览和分析 | documentId、页码范围、分析选项 | 元数据、文本摘要、页面类型、警告和证据定位 |
| pdf_get_layout | 获取页面布局 | documentId、页码、细节级别 | Region / Element 列表、Bounding Box、来源和可编辑能力 |
| pdf_stage_edits | 形成/更新修改草案 | documentId、baseRevision、Edit Operations | 新修订号、操作结果、冲突和待确认事项 |
| pdf_validate_edits | 校验并生成预览 | documentId、修订号 | 溢出、重叠、缺失字体、导出限制和视觉预览引用 |
| pdf_export | 导出选定修订 | documentId、修订号、导出选项 | 通过用户 Save As 产生的新文件及验证报告 |

约束：

- Agent 只操作当前 Task 已授权的 documentId。
- 工具不得接受任意文件系统路径作为输入目标。
- pdf_stage_edits 只改当前文档工作副本，不覆盖原 PDF。
- 导出目标由应用的 Save As 文件选择器取得；模型不能自行指定任意本机路径。
- 默认导出为新文件。覆盖原件必须是用户在 UI 明确执行的单独动作，并再次检查文件指纹。
- pdf_export 是文件写入动作，必须遵循现有 Agent 工具授权与用户可见的保存流程。
- Agent 的修改结果要能在 Workbench 中定位和撤销；不能只把“已经修改”写进聊天回复。
- 导出前的最终 PDF 必须由 Export Adapter 重新打开/解析并进行验证；验证失败时不能报告成功。

### 9.1 权限边界

- pdf_inspect / pdf_get_layout 属于文档读取能力，受现有文件读取授权约束。
- pdf_stage_edits 属于对当前编辑草稿的写入，不直接写磁盘原件。
- pdf_export 属于外部文件写入，使用现有 Tool Broker 写入权限与 Save As 流程。
- Expert 可以收窄 PDF 工具权限，不能绕过全局权限上限。
- PDF 内容始终是不可信输入；Agent 不得执行 PDF 内的脚本或将文档指令升级为工具授权。
- Renderer 只调用窄化、类型化的 Preload API，不暴露 Node.js、原始 IPC 或任意路径访问。

## 10. 保存、修订与文件生命周期

原始文件和编辑项目分离：

- 原始 PDF 不因导入、分析或编辑而修改。
- 文档项目保存来源路径的内部引用、文件指纹、页面模型、Edit Operations 和修订记录。
- 解析缓存、页面缩略图和预览图放在应用自己的 userData 缓存目录，不写入用户 Workspace 的随机临时文件。
- 编辑状态按 Task / Workspace 归属；不同 Workspace 不共享私有文档项目。
- 来源文件被移动、删除或内容变化时，显示“来源文件已变化/不可用”，要求重新授权或重新导入，不将旧坐标套用到新内容。
- Trace / Session 记录只保存文档 ID、操作摘要、结果状态和必要证据引用，不把整个 PDF 二进制或大页面图像塞进 Agent Trace SQLite。
- 项目退出后可恢复未导出的编辑草稿；删除文档项目时清理其缓存和内部编辑数据，不擅自删除原始 PDF 或已经导出的文件。

## 11. UI 与交互细节

### 11.1 分析模式

中央页面显示原始 PDF，右侧显示元素/区域检查器。点击 Agent 引用的页码和区域 ID 后，Workbench 跳转到对应页面并高亮 Bounding Box。

### 11.2 编辑模式

用户可以选择页面对象并查看：

- 当前文字、字体、字号、颜色和位置；
- 对象来源和解析置信度；
- 当前导出方式（原生修改、视觉覆盖或只读）；
- 可能影响导出的警告。

对于不支持的对象，应显示只读状态和原因，不能显示可编辑光标却无法保存。

### 11.3 预览和撤销

- 所有 Agent 修改先显示操作列表与预览。
- 可以逐项接受、拒绝或调整。
- 用户手工编辑与 Agent 操作进入同一 Undo/Redo 历史。
- 每次修改绑定基础修订号，避免 Agent 和用户并发操作互相覆盖。
- 导出预览必须显示页面差异，至少支持按页和按修改区域查看。

## 12. 导出质量和正确性

导出不是“写文件成功”就算完成。至少执行：

1. 重新打开导出 PDF，确认页数、页面尺寸、旋转和页面顺序符合预期。
2. 检查目标修改是否存在于导出的可见页面。
3. 对文本修改，检查新文本是否可提取，且不存在明显的字符丢失/编码错误。
4. 对视觉覆盖替换，检查导出页面是否出现旧文字残影、遮盖块或新文字溢出。
5. 对编辑区域做原图与导出渲染的视觉差异比较。
6. 对签名、表单、链接、注释、书签、元数据和加密等特性，给出保留/丢失/未知状态。
7. 保留验证报告；遇到无法验证的复杂页面时明确提示，而不是默认通过。

数字签名：修改签名过的 PDF 通常会导致签名失效或文档状态变化。导出前必须提示，不得声称保留了原签名有效性。

字体：优先复用可合法使用的嵌入字体资源；如果源 PDF 使用子集字体或没有可用字体资源，必须检测字体替换和缺字，不能默认 Arial 或其他字体一定可替代原排版。

## 13. 实施阶段

按可验证的价值分阶段，不一次性引入所有引擎和模型。

### P0：PDF 分析基础和 Workbench 骨架

- 在现有 Document Service 上增加 PDF Document Handle 和预检。
- 提取页面尺寸、原生文本、Text Runs、Bounding Box 和字体信息。
- 在 Agent 分析结果中引用页码和区域位置。
- 复用 PDF.js 增加页面缩略图、缩放、跳页、页面高亮和 PDF Workbench。
- 建立 PdfDocumentModel、SourceRef 和解析警告。
- 原 PDF 只读，尚不承诺原生文字修改。

验收：普通文字型 PDF 可以逐页分析；Agent 输出可定位到页面/区域；文件授权不绕过现有 Task/Workspace。

### P1：有限编辑、预览和导出

- 加入 Edit Operations、文档修订、撤销/重做。
- 支持新增文字、形状、标注和图片叠加。
- 评估并接入 pdf-lib 做基础叠加对象导出。
- 对简单背景的文字提供明确标注的视觉覆盖替换。
- 增加 Save As、重新解析、页面渲染差异和原件不变校验。
- 支持 Agent 形成修改草案，用户在 Workbench 审核。

验收：修改可以预览、撤销和导出新文件；原件哈希不变；不把视觉覆盖描述为安全删除。

### P2：Layout 重建和扫描件

- 文本行/段落聚合、区域检测、阅读顺序和图文关联。
- OCR Provider 接口和中文/日文/英文混排评估。
- 表格区域重建，人工确认后可复用现有 DuckDB。
- 页面类型识别，扫描件与混合 PDF 分开处理。
- 在结果中展示 OCR / Layout 置信度和校正入口。

验收：扫描件能识别并定位 OCR 文字；原生文本和 OCR 来源不混淆；复杂页面不确定时降级提示。

### P3：原生对象编辑和设计重建

- 完成 PDFium 对象级编辑 POC，再决定是否做正式 Adapter。
- 评估文字、图片和矢量对象的删除、替换与重写。
- 实现更可靠的字体资源映射、字距/行高控制和复杂背景处理。
- 支持 Group、Layer、设计对象重新布局和多元素编辑。
- 在通过安全 Redaction 的文本不可提取、图像不可恢复验证前，不开放“安全脱敏完成”状态。

验收：选定的支持范围内可以直接编辑源对象并可靠导出；不支持的复杂对象保持只读或要求重建。

## 14. POC 与测试样本

实施前用一组固定样本验证解析、修改和导出，不以单一简单 PDF 判断方案可行。

| 样本 | 覆盖问题 |
|---|---|
| Word 导出的文字型 PDF | 文本层、字体、行/段落聚合 |
| 金融研究/年报 PDF | 多栏、表格、图表、脚注、页眉页脚 |
| PPT/设计工具导出的 PDF | 独立文字、图片、形状、矢量和分组 |
| 扫描 PDF | OCR、语言识别、文字定位、置信度 |
| 复杂设计 PDF | 透明度、渐变、裁剪、嵌入字体、旋转和扁平化内容 |

测试必须覆盖中文、日文和英文混排，以及带空格、标点、数字、货币、百分比和长文本的编辑场景。

重点指标：

- 页面尺寸、旋转和坐标映射正确率。
- 原生文本和 OCR 文本定位准确度。
- 文本行/段落/区域聚合质量。
- 字体替换、字符缺失、文字溢出和遮盖残影。
- 导出前后页面视觉差异。
- 文件损坏、签名状态和表单/链接等特性变化。
- 原文件是否保持不变。
- 大文件和长文档下 UI 是否持续响应。

每次导出测试都要重新渲染结果 PDF；不能只断言 PDF 文件存在或能被某个库打开。

## 15. 当前明确不做的事情

- 不做在线 PDF 云转换，不上传用户文档。
- 不新增独立 Agent Runtime、云端文档服务或第二套工具权限体系。
- 不把 A2UI 当作 PDF 编辑器本身；A2UI 可以展示分析结果，具体编辑器由 React Workbench 管理。
- 不在第一阶段实现完整 Canva 模板、自由画布、多人协作和实时共同编辑。
- 不承诺所有 PDF 都能转换成完整可编辑设计文件。
- 不允许 Agent 直接写 PDF 二进制、运行任意转换脚本或指定任意导出路径。
- 不把视觉覆盖替换称为原生文字删除或安全 Redaction。
- 不强制打包大型 Python/PyTorch OCR/Layout 模型。

## 16. 待 POC 决策的问题

1. PDFium 在项目当前 macOS / Windows 打包链路中的依赖、ABI 和维护成本是否可接受。
2. pdf-lib 在目标 PDF 的字体、透明度、表单、签名和页面资源场景下是否足够稳定。
3. OCR 优先采用轻量本地 WASM 方案，还是提供可选的 Surya 本地模型适配；中文和日文质量、模型体积与冷启动需要实测。
4. PDF 项目草稿的默认保存策略、缓存配额和清理入口。
5. 第一版文字编辑支持范围：仅新增文字/覆盖式替换，还是等待 PDFium POC 后再开放原生替换。

**建议默认路径：先交付 P0 + P1 的可验证子集；P2/P3 通过 POC 决定，不为追求“像 Canva”而提前引入多套重型依赖。**
