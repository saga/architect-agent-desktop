# Layout Engine 架构设计

**状态：** 第一版功能已具备；高级交互持续完善  
**技术目标：** Electron 45、React 19、TypeScript

## 设计决策

建设由应用自身维护、与具体 Renderer 实现解耦的布局引擎。不要让 DOM 停靠布局库成为 Electron 原生视图几何位置的最终权威。

Layout Engine 是纯 TypeScript 的几何计算和工作区状态层。适配层负责将计算结果应用到：

- Electron `WebContentsView.setBounds()`
- React DOM 面板容器
- 临时原生 Overlay 视图
- 后续可能增加的浮动或独立 BrowserWindow

主进程是原生 View 的 Bounds 和层级顺序的最终权威。Renderer 上报的测量值只是输入，必须经过校验，并转换为逻辑像素视口。

## 参考项目及借鉴范围

| 项目 | 借鉴内容 | 不交由其负责的内容 |
|---|---|---|
| Dockview | 分栏和标签组交互、序列化、浮动组概念 | Electron 原生 View 的 Bounds |
| Golden Layout | 组件树、拖放停靠、焦点管理和布局持久化 | 原生 View 层级 |
| panes | 与 Renderer 分离的纯几何引擎 | 不将其 Rust/Taffy 实现作为新的运行时依赖 |
| Splitser | 浏览器场景下的分栏行为 | 不采用其 `<webview>` 嵌入方式 |
| Electron WebContentsView | 原生视图组合和 Bounds API | 应用级工作区策略 |

## 整体结构

```text
工作区状态 / 布局树（版本化 JSON）
                 |
                 v
          Layout Engine（纯 TypeScript）
                 |
          LayoutResult：id -> Rect
                 |
        +--------+---------+
        |                  |
        v                  v
 Electron View 适配器    DOM 适配器
        |                  |
 WebContentsView        React 面板
        |
 原生 View 层级管理
        |
 Browser / Agent / Overlay Views
```

## 核心职责

1. **布局模型：** 嵌套的水平/垂直分栏，以及面板约束。
2. **几何求解：** 确定性矩形计算、最小/最大约束、隐藏节点和溢出报告。
3. **工作区状态：** 当前活动面板、可见性、分栏比例、布局恢复和迁移。
4. **交互控制：** 分隔条拖动、拖放停靠、最大化/恢复和焦点管理。
5. **Electron 适配器：** 将逻辑矩形映射为原生 View Bounds，并管理层级顺序。
6. **DOM 适配器：** 对不需要原生视图的 React 界面应用相同的布局矩形。
7. **持久化：** 使用带版本号的 JSON，并提供校验和安全回退。

当前实现已经包含纯几何计算内核、版本化工作区文档持久化、Agent 四方向停靠控件、按方向调整的分隔条，以及主进程适配器。WorkspaceDocument v2 是布局持久化的唯一事实来源：分栏比例、面板显隐、方向/顺序、Tab Group 和浮动 Bounds 全部保存在同一棵树中。旧版 workspace-layout.json 只在不存在有效 v2 文档时读取一次并迁移，不再继续写入；Renderer 的像素宽度只是根据树中 Agent 面板比例和当前视口计算出的运行时几何值。主进程根据工作区分栏计算原生 Browser WebContentsView 的 Bounds。布局树工具支持左、右、上、下停靠，分栏比例更新，可见性修改，节点移除与折叠，结构规范化和重复 ID 校验。

Renderer 提供明确的四方向停靠控件、浏览器工具栏中的拖放停靠目标，以及支持横向和纵向的可调整分隔条。拖放目标目前预览四种合法停靠方向；任意嵌套分栏的实时几何预览仍待完善。AgentPanel 保持为 React DOM，并与原生 Browser View 使用同一套工作区几何。独立 Agent BrowserWindow 已支持分离、重新停靠、Bounds 持久化和应用重启后的恢复。

## 布局模型

规范模型采用二叉分栏树：

- **Panel：** 稳定 ID，以及最小/最大尺寸和可见性约束。
- **Split：** 水平或垂直方向、分栏比例、第一和第二个子节点、分隔条厚度。

该模型支持任意嵌套布局，且不与 React 或 Electron 耦合。工作区标签组具有版本化的组元数据，并提供 Browser 与 Agent 的 Renderer 切换器。选择标签组中的标签会更新持久化布局树中的面板可见性，使原生 Browser View 与 React Agent 面板共享同一个工作区位置。浏览器自身的标签栏仍是独立的浏览器标签功能。浮动 Agent 面板使用独立 BrowserWindow 根节点，并持久化窗口 Bounds，以支持重新停靠。

所有坐标均使用逻辑像素（DIP）。主进程在调用 Electron API 前，会将矩形限制在 BrowserWindow 内容区域内。设备缩放比例只在光栅化边界处理，不写入持久化布局模型。

## 当前集成方式

现有工具栏和标签栏仍由 Renderer 渲染。Renderer 上报内容区域视口矩形，主进程将该矩形交给 Layout Engine，再把计算得到的 `browser` 矩形应用到当前 WebContentsView。

主进程根据同一棵分栏树计算原生 Browser 矩形和 React Agent 面板位置。Snapshot Overlay 是由原生 View 层级管理器维护的独立图层，不参与分栏几何计算。

## 分阶段实现

### 阶段一：几何计算内核

- 纯布局树和确定性求解器。
- 最小/最大约束、可见性、零尺寸和视口不足场景处理。
- 输入校验和单元测试。

### 阶段二：主进程适配器

- 为当前 Browser WebContentsView 提供唯一布局权威。
- Bounds 限制和窗口尺寸变化合并处理。
- 提供布局版本、计算耗时和溢出诊断。

### 阶段三：工作区交互

- [x] 在 WorkspaceDocument 中持久化 Agent 分栏比例、可见性和四方向停靠位置；像素宽度按当前视口派生。
- [x] 支持方向感知的分隔条和键盘调整。
- [x] 支持纯分栏比例更新、停靠、移除/折叠、可见性修改和结构规范化。
- [x] 使用版本 2 工作区文档，支持嵌套树、标签组元数据和浮动根节点。
- [x] 将旧 workspace-layout.json 的版本 1 面板偏好一次性迁移到 WorkspaceDocument v2。
- [x] 支持 Agent 四方向停靠的拖放目标。
- [ ] 支持任意嵌套分栏目标的实时几何预览。
- [x] Browser/Agent 标签组切换器驱动持久化的面板可见性。
- [ ] 支持任意面板类型之间通用的键盘焦点顺序。

### 阶段四：原生视图组合

- [x] 集中管理原生子视图注册、Bounds 限制、可见性和图层顺序。
- [x] Browser 标签页的 WebContentsView 生命周期统一经过 NativeViewStackManager。
- [x] Snapshot Overlay WebContentsView 和 Live 模式清理。
- [ ] 将 AgentPanel React UI 迁移为原生 WebContentsView（当前组合方式不需要这样做）。

### 阶段五：高级工作区

- [x] 浮动 Agent 根节点、独立 BrowserWindow、重新停靠和 Bounds 恢复。
- [x] 工作区标签组数据模型和成员操作。
- [x] 用于切换 Browser/Agent 面板内容的标签组 UI。
- [ ] 支持 Agent 以外任意面板的浮动根节点。
- [x] 通过 Browser/Agent 标签组模式实现 Agent 最大化/恢复。
- [ ] 跨平台交互和性能测试。

## 不可破坏的约束

- 主进程是原生 WebContentsView Bounds 和层级顺序的唯一写入方。
- Renderer 不得提供任意 WebContents ID 或 View 引用。
- 无效布局输入不能传递给 Electron API。
- 隐藏面板不能保留原生鼠标命中区域。
- 面板不能获得负数、NaN 或超出窗口范围的 Bounds。
- 关闭面板时必须释放其原生 View 和监听器。
- Snapshot 是一种交互方式，不是布局树中的布局节点。
- 布局持久化只包含标识和几何数据，不包含 WebContents 实例或页面内容。

## 验收标准

- 相同布局树和相同视口必须始终计算出相同矩形。
- 所有可见面板的矩形必须是有限、非负且位于分配视口范围内。
- 在条件允许时满足最小尺寸约束；无法满足时，必须以确定方式报告溢出。
- 隐藏分栏的一侧后，另一侧应占满剩余矩形。
- 重复执行尺寸调整、激活和关闭操作，不得遗留过期 Bounds 或脱离管理的 View。
- 应用重启后，布局 JSON 能通过校验并安全恢复。
- Agent 面板宽度和可见性在应用重启后保持不变。
- Electron 适配器测试应与几何计算测试分开覆盖层级顺序和 View 生命周期。
