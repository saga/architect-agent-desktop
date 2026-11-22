# ADR-006：Schedule 专属 Browser Session 与登录 Profile

**状态：** 已采纳；真实 Electron Session 持久化/隔离及生产下载处理器自动化回归已接入 macOS / Windows CI；Schedule 登录、OAuth Popup 和 GUI Run 生命周期仍待验收  
**日期：** 2026-11-22

## 背景

Schedule 运行此前复用全局 `persist:architect-agent-browser` Session，并将 Agent Browser Tool 绑定到用户当前 Active Tab。Tab pin 只能防止 UI 切换导致的 Tab 漂移，不能隔离 Cookie、Local Storage、Cache、Service Worker 和身份登录态。一个 Schedule 因而可能读取用户日常浏览器的认证状态，也可能与用户浏览器共享同一页面。

## 决策

1. 每个 Schedule 使用独立、持久的 Electron Session partition。partition 名称由 Schedule ID 的 SHA-256 派生，不暴露原始 ID。
2. Schedule 的后台 Agent Run 使用隐藏 BrowserWindow 和专属 WebContentsView；所有 Browser Tools 只访问该 Run 的 Browser Context，不访问全局 UI Tab Map。
3. 同一个 Schedule 的专属登录窗口与后台 Run 共享该 Schedule Profile，以便用户先完成登录，后续自动运行复用登录态。不同 Schedule 之间以及 Schedule 与普通浏览器之间不共享 Cookie 或站点存储。
4. Schedule Profile 的起始 URL 可配置。Settings 页面可打开独立 Profile 进行人工登录，也可显式重置 Cookie、站点存储、HTTP Cache 和 HTTP Authentication Cache。起始 URL 必须是无内嵌凭据的 HTTP(S) 地址。
5. 登录窗口允许有界 OAuth/SSO 弹窗，子窗口显式继承同一个 Schedule Session 和 sandbox/contextIsolation 设置；弹窗 URL 仍受安全协议检查和最大嵌套层数限制。每个 Profile 的根窗口与嵌套 OAuth 子窗口都要登记生命周期；任一窗口关闭时 flush Profile，重置/删除时一并强制销毁。
6. Schedule Session 的站点权限请求默认拒绝，不弹出后台权限确认框；Display Media 请求始终拒绝。每个 Schedule 的下载自动保存到系统 Downloads 下独立的、由 Schedule 哈希隔离的目录，文件名净化并附加唯一下载 ID，不打开原生 Save 对话框；下载事件带上 Schedule ID 和实际保存路径。Profile 重置/删除时取消未完成下载，但不删除已经完成的用户文件。
7. 普通 Agent Run 继续使用用户可见 Tab pin。Memory Dreaming 的后台维护没有交互式 Browser 目标，显式使用空 Browser Context，不能回落到用户当前 Tab。
8. Schedule 的 WebContents 与隐藏 BrowserWindow 在 Run 的 finally 路径强制销毁，避免远端页面的 `beforeunload` 对话框阻塞清理；持久 Profile 数据不会在每次 Run 后清除，以保留用户认可的登录态。显式重置和删除 Schedule 时清除该 Profile 的站点数据。后台页面关闭后台节流，避免定时器被隐藏窗口冻结。
9. 创建 Browser Context 是一个有回滚的初始化过程：即使 BrowserWindow 已创建，而 WebContentsView 挂载或初始 Tab 准备失败，也必须在内部销毁已创建资源；销毁时逐项尽力 detach CDP、销毁窗口、关闭剩余 WebContents 并 flush Profile，单一步骤失败不能中断后续清理。隐藏 Run 的弹窗 Tab 创建错误必须被捕获并写入诊断记录；人工 Profile 初始化失败时强制销毁窗口，不允许远端 beforeunload 阻止回滚。

## 不采用

- 不为所有 Schedule 共用一个持久 Browser Session。
- 不复制、导出或读取普通浏览器的 Cookie。
- 不把独立 Tab、隐藏窗口或 Agent Tool Tab pin 单独视为 Session 隔离。
- 不在后台权限请求时弹出用户交互对话框。
- 不在 Schedule 结束时清除 Profile 数据；清除操作必须由用户显式触发。
- Schedule Profile 重置或删除时，不自动删除已下载到用户 Downloads 目录的文件。

## 验收

- Schedule Run 的 Browser Tool 不会读取或修改用户普通 Browser Tab。
- Schedule A 和 Schedule B 的 Cookie / Local Storage 相互隔离。
- 打开 Schedule Profile 登录后，同一 Schedule 后续 Run 可以复用该登录态。
- Profile 重置只清理目标 Schedule，不影响其他 Profile 和普通浏览器；根窗口与所有嵌套 OAuth 子窗口均关闭，未完成下载被取消；站点存储、HTTP Cache、HTTP Authentication Cache 均被尝试清理，并在完成后 flush。某一步失败仍继续其他清理步骤，并向调用方报告首个错误。
- Schedule 的弹窗、导航、下载、超时、异常和取消均不会把操作转移到用户 Tab；后台下载自动落在对应 Schedule 目录，不弹出无人值守无法处理的保存对话框。
- OAuth/SSO 弹窗继承同一 Profile，不能访问 Node.js 或 Electron 主进程 API；非 HTTP(S) 导航被阻止。
- Run 完成、失败或取消后，隐藏 BrowserWindow 与关联 WebContents 均被销毁。
- Browser Context 初始化中途失败时，已创建的窗口与 WebContents 会回滚；清理步骤单独失败不会阻止其他资源释放。
- macOS 与 Windows 的真实 Electron `persist:` Session 持久化、Schedule 间 Cookie 隔离和单 Profile 重置自动化回归已通过。实际下载已由独立 BrowserWindow + 本地 HTTP 服务进行 Electron 集成测试，并调用生产下载处理器，验证保存路径、净化后的文件名、文件内容、事件与活动下载回收；专属登录窗口、OAuth Popup 和 GUI Run 生命周期仍待人工验收。


## 自动化回归

新增 `npm run test:schedule-browser-session`，在独立 Electron 主进程中使用项目实际的 `scheduleBrowserPartition()` 与 `clearScheduleBrowserProfileData()`：第一阶段写入 Schedule A、Schedule B 和普通浏览器 partition 的 Cookie；退出 Electron 后重新启动，验证三份 Cookie 仍分别存在；随后只清理 Schedule A，并再次启动 Electron，验证 A 已清除，而 B 和普通浏览器 Cookie 保留。测试随后在真实 Electron BrowserWindow 中打开本地 HTTP 页面，触发下载，并调用与生产 Main 完全相同的 `registerScheduleBrowserDownloadHandler()`；验证下载落入 Schedule 专属目录、远端文件名被净化、文件内容正确、started/completed 事件完整、活动下载集合被清空。该测试运行于现有 macOS / Windows CI matrix，不增加 Linux runner。它验证真实 Electron `persist:` Session 的持久化/Cookie 隔离和生产下载处理器。Build run [45007115270](https://github.com/saga/architect-agent-desktop/actions/runs/45007115270) 的 macOS / Windows jobs 均通过这些测试，并成功生成对应平台安装包。它不替代外部站点登录、OAuth 弹窗和完整 Schedule GUI Run 生命周期验收。


## 退出与初始化并发

Schedule Browser Context 在初始化阶段即加入独立 Set 跟踪，不依赖 Agent Run 完成初始化后才赋值的 active Context 变量。退出流程遍历并销毁全部已登记 Context；Session 创建、隐藏 Tab、Profile 根窗口和 OAuth 子窗口均检查应用 closing 状态，避免清理快照之后又创建新资源。初始化期间若退出开始，初始化流程会以取消错误退出并执行 disposer。
