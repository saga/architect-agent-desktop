# ADR-012：本机 Loopback API 与本地模型网关

- 状态：Accepted
- 日期：2026-11-24

## 背景

桌面应用需要允许同一台机器上的浏览器、脚本和其他本地应用复用本机推理服务。这个入口不需要远程设备接入，也不应把桌面 Agent 的文件和工具权限扩展成网络服务权限。

## 决策

1. Electron 主进程随应用启动一个轻量 HTTP API，默认端口为 `4317`，固定绑定 `127.0.0.1`。
2. API 提供健康检查、模型列表和 OpenAI-compatible Chat Completions：`GET /health`、`GET /v1/models`、`POST /v1/chat/completions`。
3. API 将模型请求转发到本机运行的 OpenAI-compatible 推理服务。默认地址为 Ollama 的 `http://127.0.0.1:11434/v1`；可配置为 LM Studio、llama.cpp server 或 vLLM 的本机监听地址。
4. 推理服务地址必须是 localhost 或 loopback IP。API 校验 Host 和 Origin，并限制请求体大小；不启用通配 CORS。
5. 不提供 LAN、公网、远程设备、WebSocket 或隧道访问；不负责下载模型权重或管理推理服务进程。
6. 本地模型网关与桌面 Agent 的工具权限边界分离。它只转发模型 API 请求，不授予文件、Shell、浏览器或其他 Agent 工具权限。

## 配置

- `ARCHITECT_LOCAL_SERVER_PORT`：本机 API 端口，默认 `4317`。
- `ARCHITECT_LOCAL_LLM_BASE_URL`：本机模型服务 API base URL。
- `ARCHITECT_LOCAL_LLM_API_KEY`：可选的上游 Bearer Token。

## 后果

本机程序可以通过稳定的 OpenAI-compatible 接口使用本地模型，而无需让推理服务直接暴露给其他应用。模型进程仍由 Ollama、LM Studio、llama.cpp server 或 vLLM 自身管理；桌面应用负责本机 API 入口和请求转发。
