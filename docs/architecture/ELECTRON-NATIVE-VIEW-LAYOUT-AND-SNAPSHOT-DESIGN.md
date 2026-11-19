# Electron 原生视图布局与 Snapshot 交互设计

- 状态：设计提案（不代表全部功能已实现）
- 适用项目：Architect Agent Desktop
- 技术基线：Electron 45、React、TypeScript、WebContentsView
- 更新日期：2026-11-19

## 1. 背景与要解决的问题

应用不是一个普通的单页面 React 应用。主窗口的工具栏、标签栏和 Agent UI 由 Renderer DOM 渲染；网页内容由主进程创建的 `WebContentsView` 承载，并通过 `contentView.addChildView()` 加入主窗口。

这意味着网页不是 Renderer DOM 中的 iframe 或普通元素。它由 Electron 原生 View 系统独立布局和合成，Renderer 内的 CSS `z-index`、Ant Design Modal、Drawer 等不能可靠地覆盖它。

当前主进程已有以下布局机制：

- 每个浏览器 Tab 持有独立的 `WebContentsView`。
- 激活 Tab 时将对应 View 加入主窗口 `contentView`。
- `updateActiveBounds()` 根据 Renderer 上报的 top、left、width 设置网页 View 的 Bounds。
- Agent 面板当前属于 Renderer UI；它不能天然盖在网页 WebContentsView 上。
- Agent 配置已采用独立的原生 `BrowserWindow` 模态子窗口，避免 DOM 弹窗被网页 View 遮挡。

本设计解决三个问题：

1. 明确常驻浏览器、Agent 侧栏、浮层和原生设置窗口的视图归属与层级。
2. 为后续复杂交互提供可扩展的 Overlay 能力。
3. 判断何时需要 Snapshot，以及如何避免 Snapshot 成为默认渲染路径。

## 2. 设计结论

采用分层组合，而不是押注单一技术：

| 交互类型 | 首选方案 | 说明 |
|---|---|---|
| 浏览器与常驻 Agent 侧栏并排 | 动态 Bounds | 两个区域互不覆盖，网页保持实时可交互 |
| 配置、偏好设置、独立复杂表单 | 原生模态 BrowserWindow | 系统级窗口层级，不受网页 WebContentsView 遮挡 |
| 轻量浮层、工具提示、Agent 快捷操作 | 原生 Overlay WebContentsView | 与网页处于同一原生 View 层级，按需覆盖 |
| 需要 DOM 半透明遮罩、复杂动画，且允许背景网页暂时不可交互 | Snapshot + Renderer Overlay | 暂时以静态图像替换网页 View，再显示 DOM 遮罩和弹层 |
| 必须在弹层期间继续操作网页 | Live WebContentsView Overlay | 不使用 Snapshot；背景页面保持实时 |

**Snapshot 是需要保留的能力，但不是默认方案，也不是所有弹窗的前置步骤。** 它解决的是“需要 DOM 级视觉叠加，但底层网页 View 无法被 DOM 覆盖”的特殊问题，不解决实时网页交互问题。

## 3. 目标视图架构

主窗口保留现有 BrowserWindow + WebContentsView 体系。主进程统一管理所有原生子 View 的生命周期、Bounds 和显示顺序。

建议的视图组成：

1. Main Renderer：应用工具栏、标签栏、状态栏、常驻 Agent UI，以及必要时的 Snapshot 背景和 DOM Overlay。
2. Active Browser WebContentsView：当前活动网页。
3. Agent Panel WebContentsView（可选演进）：当 Agent 面板需要独立滚动、独立焦点、覆盖网页或复杂交互时，将 Agent UI 从 DOM 迁移为独立 View。第一阶段不要求立即迁移。
4. Live Overlay WebContentsView（按需创建或复用）：只承载轻量浮层交互，位于浏览器 View 上方。
5. Native Dialog BrowserWindow：设置、账户、需要系统窗口体验的长表单。它是独立原生子窗口，不加入主窗口的 View 栈。

示意：

```text
BrowserWindow
├── Main Renderer (toolbar / tabs / app chrome)
├── Active Browser WebContentsView
├── Agent Panel WebContentsView (future, optional)
└── Live Overlay WebContentsView (transient, optional)

Native child BrowserWindow
└── Agent Settings / Preferences
```

注意：示意中的层级由主进程通过 View 添加顺序与 Bounds 管理；不是 DOM 的 z-index 层级。若采用 Snapshot 模式，浏览器 View 会在快照捕获后临时隐藏或移出可见布局，Renderer 显示快照图像，DOM Overlay 才能自然覆盖快照。

## 4. 三种布局与交互模式

### 4.1 Docked / Bounds 模式（常驻布局）

浏览器和 Agent 面板并排。主进程根据窗口尺寸和布局状态计算：

- 浏览器区域 Bounds
- Agent 面板 Bounds（若为独立 WebContentsView）
- 工具栏和标签栏以下的内容起始位置
- 最小宽度和窄窗口降级策略

Bounds 计算必须集中在主进程的 Layout Controller，不允许各个 Renderer 功能模块直接修改浏览器 View 的 Bounds。

建议输入为逻辑像素（DIP），统一由主进程执行取整和边界裁剪。窗口 resize、侧栏开关、侧栏宽度变化、窗口最大化和显示器变化都触发布局更新。更新应合并短时间内连续的 resize 事件，避免每个像素变化都触发多次跨进程消息。

### 4.2 Live Overlay 模式（实时原生浮层）

适用于需要盖住网页，但背景网页仍必须保持真实、动态和可交互的场景。

实现方式：

- 主进程创建或复用 Overlay WebContentsView。
- Overlay 的 Bounds 由主进程计算，通常覆盖目标区域或整个网页区域。
- 将 Overlay 加入主窗口 contentView，并确保它位于目标 Browser View 之上。
- 关闭时隐藏或移除 Overlay；复用时避免反复创建 WebContents。
- Overlay 只承载必要交互，不承载整套 Agent 页面。
- 明确焦点策略：打开时焦点进入 Overlay；关闭时恢复到之前的 Browser WebContents。
- 如果 Overlay 需要背景透明，必须在目标 Electron 版本和 macOS / Windows / Linux 上做实际验证。不要假设 CSS 的透明背景一定能得到跨平台一致的原生合成效果。

Electron 的迁移文档说明，对已经加入的 View 再次调用 `addChildView()` 可以将其重新排序到顶部；应由主进程集中控制顺序，避免多个模块互相抢层级。

### 4.3 Snapshot 模式（静态网页背景 + DOM Overlay）

适用于必须使用 Renderer DOM / Ant Design 完成的复杂模态交互，例如：

- 复杂的多步骤向导、属性编辑器或布局配置器，需要半透明遮罩、模糊背景、复杂动画和大量 DOM 控件。
- 交互期间不要求用户继续操作底层网页。
- 需要保留用户打开弹层瞬间的网页视觉上下文，避免直接切换到空白页面或独立窗口。
- 需要在 DOM 中使用成熟的无障碍、键盘导航、表单校验和组件库能力。

推荐流程：

1. Renderer 请求进入 Snapshot 模式，并提供请求 ID 和目标 Tab ID。
2. 主进程确认当前活动 Tab、窗口可见状态和当前布局版本。
3. 主进程调用当前 Tab 的 `webContents.capturePage()` 获取可见区域图像；截图应针对可见网页区域，而不是无条件截取整个桌面。
4. 主进程记录 Snapshot 元数据：Tab ID、URL、Bounds、设备缩放比例、捕获时间、布局版本、滚动位置（能可靠取得时）。
5. 将图像转换为适合 Renderer 消费的受控数据形式，并发送给可信应用 Renderer。优先评估是否能通过应用内部临时资源/受控协议传递，避免在 IPC 中反复传输大体积 Base64。
6. 主进程将浏览器 View 隐藏或从可见布局移除，但保留 WebContents 和 Tab 实例，不销毁网页会话。
7. Renderer 显示 Snapshot 图像作为背景，再显示 DOM 遮罩和复杂弹层。
8. 交互期间阻止底层网页输入；弹层关闭、取消或超时后，Renderer 请求退出 Snapshot。
9. 主进程恢复原 Browser View 的 Bounds 和可见状态，Renderer 清理快照资源，恢复焦点到原网页或指定控件。
10. 若期间 Tab 已关闭、导航、切换或窗口尺寸改变，按恢复策略重新捕获或放弃旧 Snapshot，不能直接把过期截图当成当前网页。

重要语义：Snapshot 只冻结视觉，不等于冻结网页执行环境。移出可见区域或隐藏 View 并不保证页面 JavaScript、网络请求、定时器和媒体播放停止。若业务要求页面执行也暂停，需要单独定义并测试暂停策略；不能把截图模式描述为“网页完全冻结”。

### 4.4 Hybrid 模式

Hybrid 是 Snapshot 与 Live Overlay 的组合，不是额外的截图技术：

- 背景使用 Snapshot，提供静态、可遮罩的视觉上下文。
- 主要复杂表单使用 Renderer DOM。
- 某些必须维持原生 WebContents 行为的子交互（例如网页原生授权流程）仍走独立 BrowserWindow 或 Live View。
- 进入和退出 Hybrid 时由同一个 Interaction Coordinator 管理状态，避免多个模块分别控制 View。

默认不启用 Hybrid。只有当一个交互确实同时需要静态网页背景和原生实时子交互时才使用。

## 5. Snapshot 是否必要：决策规则

按以下顺序判断：

1. 只是常驻侧栏或布局变化：Bounds。
2. 是设置或长表单：原生 BrowserWindow。
3. 是轻量网页上方浮层，底层还要继续交互：Live Overlay WebContentsView。
4. 是复杂 DOM 模态交互，底层不需要交互，但需要保留网页视觉上下文：Snapshot。
5. 需要半透明遮罩，但底层网页仍要实时操作：Snapshot 不适用；优先 Live Overlay，并验证原生透明合成。若无法达到体验要求，重新评估交互设计或采用独立原生窗口。

不应仅因为“想要半透明遮罩”就默认截图。应先判断遮罩期间网页是否需要交互。

## 6. 主进程职责与接口建议

新增独立的 View Layout / Interaction Coordinator，不把复杂状态继续堆入 `index.ts`。

建议职责：

- Layout Controller：计算 Browser、Agent Panel、Overlay Bounds。
- View Stack Manager：管理 WebContentsView 的创建、加入、移除、排序和销毁。
- Interaction Coordinator：管理 Docked、Live Overlay、Snapshot、Hybrid 的状态转换。
- Snapshot Service：截图、元数据、资源生命周期和失效检测。
- Window Manager：管理设置等原生 BrowserWindow。

建议抽象接口（仅为设计示例，不代表当前代码已实现）：

```ts
type InteractionMode = "docked" | "live-overlay" | "snapshot" | "hybrid";

interface SnapshotMetadata {
  requestId: string;
  tabId: string;
  url: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  capturedAt: number;
  layoutVersion: number;
}

interface InteractionCoordinator {
  openLiveOverlay(input: { kind: string; bounds?: Rectangle }): Promise<void>;
  closeLiveOverlay(): Promise<void>;
  enterSnapshot(input: { tabId: string; reason: string }): Promise<SnapshotMetadata>;
  exitSnapshot(input: { requestId: string }): Promise<void>;
  getMode(): InteractionMode;
}
```

IPC 约束：

- 所有输入使用 Zod schema 校验。
- 每次模式切换带 requestId，避免旧请求覆盖新状态。
- 只允许主窗口可信 Renderer 调用视图控制 IPC。
- Renderer 不直接指定任意 WebContents ID，不直接控制任意 View 的 Bounds。
- 主进程验证 Tab ID 仍存在且为允许的目标。
- 模式切换必须幂等；重复 open/close 不得创建重复 View 或遗留遮罩。
- 发生异常时优先恢复可交互网页，不允许把窗口留在空白 Snapshot 状态。

## 7. 状态机与失败恢复

建议状态：

- `docked`：常规并排布局。
- `live-overlay-opening` / `live-overlay` / `live-overlay-closing`。
- `snapshot-capturing` / `snapshot` / `snapshot-restoring`。
- `hybrid`：仅在组合场景启用。

关键不变量：

1. 同一时刻最多有一个活动的模态交互会话。
2. Snapshot 会话必须绑定原 Tab ID 和请求 ID。
3. 任何失败路径都必须释放 Snapshot 图像资源并恢复 Browser View。
4. 用户切换 Tab、关闭 Tab、导航到新 URL 或关闭窗口时，必须取消或使 Snapshot 会话失效。
5. 原生设置窗口与 Snapshot 会话互斥；打开设置窗口前退出 Snapshot。
6. Overlay 关闭后必须恢复正确的焦点目标。
7. 主窗口失焦、最小化和恢复时，不能重复创建浮层或重复捕获截图。

失败处理：

- 截图失败：不隐藏网页 View，向调用方返回失败。
- IPC 超时或 Renderer 崩溃：主进程 watchdog 清理交互状态并恢复网页 View。
- Snapshot 数据过期：丢弃截图并重新捕获，或者取消交互；不得静默展示错误页面快照。
- Tab 被关闭：取消交互，销毁关联资源。
- 恢复失败：提供可见的“返回网页”恢复动作，并记录诊断日志。

## 8. 性能、资源与安全要求

### 性能

- Snapshot 只在进入模态交互时捕获，不做周期性截图。
- 对截图尺寸设置上限；优先捕获网页可视区域，避免整页长截图。
- 评估 NativeImage 到 Renderer 的传输成本；大图传输不能在每次状态更新时重复发生。
- Snapshot 会话结束后立即释放 NativeImage、临时文件或 URL 资源。
- 同一交互重复打开时复用有效快照，前提是 Tab、URL、Bounds 和布局版本均未变化。
- 复杂浮层优先复用 WebContentsView，避免每次打开都创建和销毁 Chromium WebContents。
- resize 事件应节流或合并，Bounds 更新由主进程集中执行。

### 安全

- 网页内容是不可信输入；不允许网页页面直接请求创建应用 Overlay 或 Snapshot。
- Snapshot 图像只在本应用可信 Renderer 中显示，不提供网页脚本访问路径。
- IPC sender 必须校验，所有参数必须 schema 校验。
- 不把任意本地文件路径、任意 URL 或任意 WebContents 标识暴露给 Renderer。
- 截图可能包含用户浏览内容、账户信息和敏感页面；默认只保存在内存，不写入持久日志或磁盘。确需落盘时必须有明确的生命周期和清理策略。
- 诊断日志只记录 requestId、Tab ID、耗时、图像尺寸和状态，不记录截图像素或页面正文。

## 9. 分阶段实施计划

### Phase 0：稳定当前行为

- 保留当前动态 Bounds 机制。
- 保留独立原生 Agent Settings BrowserWindow。
- 明确 Renderer DOM Modal 不得覆盖网页 WebContentsView 的架构约束。
- 补充窗口 resize、侧栏开关和设置窗口的回归测试。

### Phase 1：统一布局管理

- 将当前分散的 `contentTop/contentLeft/contentWidth/updateActiveBounds()` 收敛到 Layout Controller。
- 统一管理浏览器 View Bounds，预留 Agent Panel View 和 Overlay View 的布局接口。
- 明确逻辑像素、窗口内容区域坐标和设备缩放处理。
- 先不迁移 Agent UI，避免同时改变 UI 和布局机制。

### Phase 2：Live Overlay PoC

- 创建最小 Overlay WebContentsView 原型。
- 验证 macOS、Windows、Linux 的透明背景、焦点、键盘输入、鼠标命中和层级顺序。
- 验证 Overlay 不影响浏览器 Tab 的导航、滚动和输入状态。
- 如果透明合成跨平台不一致，限制透明效果，不能用 Snapshot 偷偷替代实时模式。

### Phase 3：Snapshot PoC

- 只实现一个明确场景：复杂 DOM 模态表单，网页背景静态显示，网页交互暂停。
- 测量截图耗时、图片体积、IPC 传输、显示首帧和恢复耗时。
- 测试 Tab 导航、Tab 关闭、窗口 resize、缩放比例变化、窗口最小化、Renderer reload 和应用退出。
- 确认恢复后网页 DOM、滚动位置、输入焦点、媒体和会话状态符合预期。

### Phase 4：按需扩展 Hybrid

- 只有出现明确产品场景才实现 Hybrid。
- 不为抽象的“未来可能复杂”提前增加多套并行状态机。
- 每个复杂交互声明所需模式、背景是否实时、是否允许页面输入、焦点恢复目标和失败回退方式。

## 10. 验收标准

- 常驻 Agent 侧栏显示/隐藏和调整宽度时，网页无白屏、无意外导航，滚动位置不丢失。
- Agent 设置窗口始终显示在主窗口上方，关闭后主窗口恢复可操作。
- Live Overlay 能覆盖目标网页区域，键盘焦点和关闭后焦点恢复正确。
- Snapshot 模式下背景图像与捕获时刻一致，网页无法被误操作。
- Snapshot 退出后恢复同一 Tab 的原 WebContents，不重新加载页面，不丢失页面会话。
- Snapshot 会话遇到 Tab 关闭、导航、窗口 resize 或异常时能安全退出，不留下空白区域。
- 多次快速打开/关闭不产生重复 View、残留遮罩、监听器或持续增长的内存。
- 所有模式切换都有耗时、结果和失败原因日志；不记录页面内容或截图。
- 在 macOS Apple Silicon 上完成手工验收，并至少在 Windows 做关键层级和焦点回归。

## 11. 需要避免的实现误区

- 不要用 CSS `z-index` 解决原生 WebContentsView 遮挡。
- 不要把整个 Agent Panel、浏览器页面和设置页全部迁移成多个 View；只把确有原生层级需求的部分拆出来。
- 不要把 Snapshot 当作 Live Overlay 的替代品。
- 不要把隐藏 View 等同于暂停网页执行。
- 不要把 BrowserWindow 设置弹窗改成截图遮罩；系统级长表单优先原生窗口。
- 不要将所有布局坐标由 Renderer 计算后直接写入 View；主进程必须是 Bounds 的最终裁决者。
- 不要在没有跨平台验证前承诺透明 WebContentsView 可以实现完全一致的半透明效果。

## 12. 参考资料

- [Electron WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron BaseWindow API](https://www.electronjs.org/docs/latest/api/base-window)
- [Electron BrowserWindow API（capturePage）](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron Web Embeds 指南](https://www.electronjs.org/docs/latest/tutorial/web-embeds)
- [从 BrowserView 迁移到 WebContentsView](https://www.electronjs.org/blog/migrate-to-webcontentsview)

---

**最终决策：** 以 Bounds 作为常规布局机制，以原生 BrowserWindow 处理独立设置/长表单，以 Live Overlay WebContentsView 处理需要实时网页背景的浮层，以 Snapshot 处理必须使用 DOM 复杂模态交互且允许背景静态化的场景。Snapshot 能力应设计进架构，但按具体交互按需启用。
