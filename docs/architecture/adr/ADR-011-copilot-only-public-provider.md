# ADR-011：正式版本 Copilot-only 与本机 CodeBuddy Dev Mode

- 状态：Accepted
- 日期：2026-11-23

## 背景

项目同时维护 GitHub Copilot SDK 和 CodeBuddy SDK 两条 Agent Provider 路径。CodeBuddy 主要用于开发者本机实验、验证工具接入和快速调试；它不需要成为面向公众的正式 Provider，也不需要与 Copilot SDK 达到完整功能对等。

如果 Provider 可见性仅由 Renderer 隐藏控制，用户仍可能通过 IPC、旧设置文件或直接请求进入 CodeBuddy 路径。正式安装包也不应因为环境变量或用户本机 CodeBuddy 配置而意外开放这条路径。

## 决策

1. 正式公开构建只支持 GitHub Copilot SDK。
2. CodeBuddy 是仅供开发者本机使用的开发适配器，不属于正式产品支持矩阵，不承诺功能完整度、兼容性或发布支持。
3. 仓库根目录 .env 的 ARCHITECT_AGENT_DEV_MODE=true 启用本机 Dev Mode。环境变量缺失、空值或非 true 时默认为 Copilot-only。
4. Dev Mode 只允许在未打包的开发运行中启用；app.isPackaged === true 时无条件禁用，即使系统环境变量显式设为 true。
5. Provider 能力由 Main 进程确定并通过受信 IPC 返回。Renderer 只根据能力列表显示 CodeBuddy；Main IPC、Agent configure、模型发现和请求派发再次校验，不能依赖 UI 隐藏作为安全边界。
6. 当 Dev Mode 关闭时，旧设置文件中保存的 CodeBuddy Provider 自动回退到 Copilot；直接提交 CodeBuddy 设置或模型发现请求必须失败。
7. CodeBuddy SDK 放在 devDependencies，不进入正式安装包的生产依赖树；CodeBuddy 不作为 Copilot 启动失败时的 fallback。

## 配置

开发者本机 .env 示例：

    ARCHITECT_AGENT_DEV_MODE=true

默认不设置该变量，等同于 false。.env.example 记录默认关闭状态；真实 .env 不提交版本控制。

## 后果

- 正式用户只看到 Copilot Provider，产品支持与故障诊断路径更明确。
- 开发者可在本机启用 CodeBuddy，继续验证其 SDK、工具和模型适配。
- Dev Mode 不代表 CodeBuddy 具备完整产品质量，也不改变 Copilot-only 发布承诺。
- 本 ADR 不要求立即移除 CodeBuddy 代码或开发依赖；未来可根据维护成本决定是否拆分为独立开发包。

## 验收标准

- 未打包运行且 .env 缺少开关时，Provider 列表只有 Copilot。
- 未打包运行且 .env 明确启用时，Provider 列表包含 Copilot 和 CodeBuddy。
- 打包构建无条件只允许 Copilot。
- IPC、配置持久化、模型发现和请求执行均拒绝 Dev Mode 关闭时的 CodeBuddy 请求。
- Dev Mode 关闭时，旧配置中的 CodeBuddy Provider 回退到 Copilot。
- Copilot 失败不触发 CodeBuddy fallback。
