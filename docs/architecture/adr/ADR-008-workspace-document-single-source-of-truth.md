# ADR-008：WorkspaceDocument 作为唯一布局状态来源

**状态：** 已采纳，代码与迁移测试已加入；等待 CI 验证  
**日期：** 2026-11-22

## 背景

布局升级到 WorkspaceDocument v2 后，应用仍同时维护 workspace-layout.json 与 workspace-document.json。前者保存 Agent 面板像素宽度、显隐和方向；后者保存分栏树、比例、面板可见性、Tab Group 和浮动 Bounds。Main 通过额外 IPC 更新旧状态，再把它转换回分栏树；Renderer 同时订阅旧布局事件和新文档更新。

这形成两个可表达同一事实的持久化来源。保存顺序、事件时序或窗口尺寸变化都可能造成状态漂移，也让布局状态管理复杂度超过实际需要。

## 决策

1. WorkspaceDocument v2 是唯一持久化布局模型。分栏比例、方向/顺序、面板可见性、活动 Tab Group 和浮动窗口 Bounds 均以布局树为准。
2. 移除 WorkspaceLayoutState、workspace:get-layout / workspace:save-layout IPC、workspace:layout-updated 事件，以及 Renderer 对这些状态的第二套订阅和保存逻辑。
3. Renderer 的 agentWidth 只作为当前窗口中的运行时像素几何值；从 WorkspaceDocument 中 Agent 面板的比例与当前视口尺寸派生。拖动分隔条时更新本地像素值，结束拖动后把比例写回 WorkspaceDocument。
4. 方向和显隐直接通过 WorkspaceDocument 树节点表达。方向变化保留 Agent 面板原有相对比例；隐藏面板不清除其比例，以便重新显示或从浮动窗口停靠时恢复尺寸。
5. 旧 workspace-layout.json 仅作为一次性迁移输入：只有在没有有效 WorkspaceDocument v2 时才读取，迁移成功后写入 v2 文档；以后不再写回旧文件。v1 偏好迁移由 WorkspaceDocument parser 统一完成。
6. 不再引入额外 Layout Store、Context Provider 或新的状态管理依赖。

## 不采用

- 不继续双写旧布局文件和 WorkspaceDocument。
- 不通过 Main IPC/event 同步两份同义布局状态。
- 不把像素宽度作为独立持久化字段；视口改变时由比例重新计算。
- 不为当前两个面板场景引入全局状态库或更复杂的状态机。

## 验收

- WorkspaceDocument v2 可独立恢复 Agent 面板方向、显隐和比例。
- 旧 v1 文件只用于首次迁移，迁移后不再被读取或更新。
- 四方向停靠保持 Agent 面板相对比例。
- 隐藏、分组、浮动、重新停靠不会丢失分栏比例。
- 拖动分隔条后重新加载文档，比例可往返恢复。
- Main、Preload、Renderer 不再包含 WorkspaceLayoutState 双写 API 或布局更新事件。
- 自动化测试和 CI 通过；GUI 验收另行覆盖窗口缩放、拖动、浮动与重新停靠。
