# Electron 原生视图布局与 Snapshot 交互设计

- 状态：设计说明；已实现能力以代码为准
- 适用项目：Architect Agent Desktop
- 技术基线：Electron、React、TypeScript、WebContentsView

## 1. 当前结构与问题

主窗口同时包含 Renderer DOM 和 Electron 原生 `WebContentsView`：

- 工具栏、标签栏和 Agent UI 由 Renderer DOM 渲染。
- 浏览器页面由主进程创建的 `WebContentsView` 承载。
- DOM 的 CSS `z-index`、Modal、Drawer 不能可靠覆盖原生 WebContentsView。
- 主进程负责原生 View 的生命周期、Bounds 和层级。

因此，布局和交互必须区分 DOM 区域与原生 View 区域，不能试图用 CSS 解决原生层级问题。

## 2. 保留三种明确机制

| 场景 | 机制 | 使用原则 |
|---|---|---|
| 浏览器与 Agent 面板并排 | Layout Engine + Bounds | 默认布局方式，网页保持实时可交互 |
| 设置、偏好和独立长表单 | 原生 BrowserWindow | 使用现有窗口机制，不引入额外弹窗框架 |
| 需要覆盖网页的交互 | 原生 Overlay WebContentsView；特殊情况下使用 Snapshot | 只有 DOM 无法满足且有明确交互需求时才使用 |

Snapshot 不是默认渲染路径。它只解决一种特殊情况：弹层需要 Renderer DOM 的复杂组件能力，底层网页在弹层期间可以暂时不可交互，但仍需保留网页的视觉上下文。

如果没有真实产品场景，不需要为 Snapshot 增加额外模式或抽象。

## 3. 职责边界

保持两个清晰的职责：

**Layout Engine**
- 维护工作区布局树、分割比例、面板可见性和尺寸约束。
- 根据窗口可用区域计算各面板矩形。
- 持久化和恢复版本化布局。
- 不负责截图、弹窗业务或插件生命周期。

详见 [Layout Engine](./LAYOUT-ENGINE.md)。

**主进程 Native View 管理**
- 创建、复用、隐藏、移除和销毁原生 View。
- 将 Layout Engine 的矩形应用到对应 WebContentsView。
- 统一管理原生 View 的显示顺序。
- 校验来自可信 Renderer 的请求，不暴露任意 WebContents ID 或 Electron 对象。

不再额外拆分 Layout Controller、View Stack Manager、Interaction Coordinator、Snapshot Service、Window Manager 等多个独立子系统。它们只有在代码规模和职责确实增长时，才考虑拆成模块；不预先建立一组相互调用的管理器。

## 4. Overlay 与 Snapshot

优先使用原生 Overlay WebContentsView。Overlay 与浏览器页面处于同一原生 View 层级，由主进程控制 Bounds 和顺序。

仅当以下条件同时满足时使用 Snapshot：

1. 交互必须使用 Renderer DOM 或现有组件库。
2. 需要保留网页的视觉上下文。
3. 弹层期间不要求底层网页继续接受用户输入。

基本流程：

1. 主进程确认目标 Tab 仍存在并捕获当前可视网页区域。
2. 暂时隐藏浏览器 View，但保留原 WebContents 和 Tab，不重新加载页面。
3. Renderer 显示截图和 DOM 弹层。
4. 交互结束或失败时清理截图资源，恢复原 View 和焦点。

Snapshot 只冻结视觉，不保证网页 JavaScript、网络请求或媒体播放停止。不要把它描述为网页执行环境的暂停机制。

不设计 Hybrid 模式。若一个具体场景同时需要静态背景和实时原生子交互，应先用现有 BrowserWindow 或 Overlay 组合解决；只有出现无法满足的实际需求，再单独评估。

## 5. 必须保证的行为

- Bounds 只由主进程最终应用；Renderer 提供的尺寸必须校验并限制在窗口内容区域内。
- View 显示顺序由主进程统一管理，避免多个功能模块互相覆盖层级。
- Snapshot 失败时不得先隐藏网页；任何退出路径都必须恢复原网页 View。
- Tab 关闭、导航或窗口关闭时，清理关联截图和 Overlay 状态。
- Snapshot 默认只保存在内存，不记录截图内容或页面正文。
- 快速重复打开/关闭不得遗留 View、监听器或遮罩。
- 恢复原页面时复用原 WebContents，不重新加载网页。

异步操作需要防止过期请求覆盖新状态；只有在确实存在并发操作时才使用请求标识，不为所有普通布局更新引入统一会话状态机。

## 6. 不做的设计

- 不增加 Docked、Live、Snapshot、Hybrid 四套并列布局状态机。
- 不把 Snapshot 作为 Live Overlay 的通用替代品。
- 不为每一种弹窗创建新的 WebContentsView。
- 不把整个 Agent 面板迁移成原生 View，除非出现明确的层级或交互需求。
- 不重复实现 Layout Engine 已负责的几何计算和布局持久化。
- 不为未来可能出现的交互提前建设通用 Interaction Framework。

## 7. 参考资料

- [Electron WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron Web Embeds 指南](https://www.electronjs.org/docs/latest/tutorial/web-embeds)
- [从 BrowserView 迁移到 WebContentsView](https://www.electronjs.org/blog/migrate-to-webcontentsview)
