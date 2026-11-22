# ADR-005：Renderer 提供 Browser View 实际几何

**状态：** 已采纳并实现  
**日期：** 2026-11-22

## 背景

Renderer 通过 CSS Grid 展示 Sidepanel 和 Pure Agent 布局，而 Main Process 又根据 WorkspaceDocument、WorkspaceLayoutState 和自己的布局计算重新推导 Browser `WebContentsView` 的位置和尺寸。两边各自计算同一块区域，容易在分栏、Tab Group、垂直停靠、窗口缩放和 Pure Agent 模式下出现偏差。

## 决策

1. Renderer 是 CSS 布局的唯一拥有者，使用 DOM 实测 Browser 内容区域矩形。
2. Renderer 将完整的 `x/y/width/height` 通过受信任 IPC 发送给 Main。
3. Main 负责校验消息、裁剪到 BrowserWindow content viewport，并应用给原生 View。
4. Sidepanel 与 Pure Agent 使用同一套 Bounds IPC 契约。
5. WorkspaceDocument 继续保存布局树、Tab Group、浮动面板等布局语义；Main 不再从布局树重新计算 Browser 内容矩形。

## 不采用

- 不在 Main 和 Renderer 各自维护完整的像素布局算法。
- 不把 Renderer 提交的矩形直接传给 Electron；Main 仍须验证并裁剪到窗口范围。
- 不移除纯布局算法与单元测试；它仍用于布局树计算和 UI 布局语义，但不是 Native Browser View 几何的第二事实来源。

## 验收

- Bounds 消息具有完整矩形。
- Main 不再根据 WorkspaceDocument 调用 Layout Engine 计算 Browser View Bounds。
- Sidepanel / Pure Agent 都以 DOM 实测矩形更新 Browser View。
- 页面区域隐藏、窗口缩放或面板切换后，Native View 会跟随测量值或收到零尺寸矩形。
