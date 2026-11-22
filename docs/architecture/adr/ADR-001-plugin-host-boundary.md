# ADR-001：由宿主应用管理声明式插件包

**状态：** 已采纳并进入第一版实现  
**日期：** 2026-11-19

## 背景

不同团队需要组合使用不同的 Skills、Tools、Workflows 和工作区视图。通过硬编码团队模式或维护多个应用构建版本来实现，会增加长期维护成本。通用的可执行插件运行时则会在当前没有明确需求时，引入较大的安全和生命周期复杂度。

## 决策

采用本地声明式插件包。插件包包含精简清单和可选资源文件，可以提供 Skills、宿主应用现有工具的引用、工作流定义，以及宿主应用已支持的视图声明。

插件包的导入、校验、登记、启用/停用和删除均由宿主应用负责。插件不运行任意代码，不修改宿主应用内部实现，也不能控制 Electron 对象。

Tool 引用只能指向宿主应用已有工具。所有执行和权限检查仍由应用现有的宿主控制路径负责；插件系统不另建一套工具运行时或授权框架。

## 第一版实施范围

- 已实现本地插件目录导入、导出、启用、停用和删除。
- 已实现 Manifest、资源路径、文件类型、符号链接和宿主工具/View 标识校验。
- 启用插件的 Skills 与 Workflow 模板会注入现有 Agent 指令。
- Tool 引用只能指向宿主已实现工具，不授予权限；执行仍走应用现有权限检查。
- 插件管理通过受信任的配置窗口 IPC 执行，插件内容不会作为代码运行。
- 当前只支持目录包；ZIP 导入、插件自带 UI、插件市场、依赖解析、事件钩子和远程管理暂不实现。
- 团队 Profile 组合不属于本 ADR 的实现前置条件，相关方案暂缓。

## 影响

- 不需要为不同团队维护独立的应用构建版本。
- 插件注册表只负责安装状态和声明内容，不构成第二套工具运行时或授权系统。
- 只有在能够带来实际收益时，才将现有功能迁移为插件。

## Provider 原生插件加载

插件运行时目录由宿主注册表审批、内容指纹校验后再复制到当前 Agent 请求的临时快照目录。Copilot SDK 使用 `RuntimeConnection.forStdio({ args: ['--plugin-dir', directory] })` 显式传入目录，并设置 `COPILOT_PLUGIN_DIR_ONLY=true` 禁止加载用户主目录中的隐式插件。CodeBuddy SDK 使用 `CODEBUDDY_PLUGIN_DIRS` 注入目录列表；环境变量必须先剔除大小写不同的继承值，再只加入本次获批快照，路径列表按当前操作系统 `path.delimiter` 拼接（Windows 不能硬编码冒号，否则盘符会被误拆）。

两条 Provider 路径都受同一权限闸门约束：全局权限必须为 Allow all，Expert 也必须显式允许全部工具；仅有 Skill 选择或插件启用状态不足以授予可执行运行时。Copilot 官方 SDK 的 [plugin directories 文档](https://github.com/microsoft/copilot-sdk/blob/main/docs/features/plugin-directories.md) 和 CodeBuddy 的 [插件环境变量文档](https://www.codebuddy.ai/docs/zh/cli/env-vars) 分别定义了上述原生加载入口。
