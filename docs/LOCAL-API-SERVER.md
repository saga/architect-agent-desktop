# Local API Server

Architect Agent Desktop can expose a small HTTP API to other applications running on the same computer. It listens only on `127.0.0.1`; it does not accept LAN or Internet connections and has no remote-device mode.

The server starts with the desktop application on port `4317` by default.

- `GET http://127.0.0.1:4317/health`
- `GET http://127.0.0.1:4317/v1/models`
- `POST http://127.0.0.1:4317/v1/chat/completions`

The model endpoints use an OpenAI-compatible local inference server. Ollama is supported through its OpenAI-compatible API; LM Studio, llama.cpp server and vLLM can be used when configured with a loopback URL.

Environment configuration:

- `ARCHITECT_LOCAL_SERVER_PORT`: local API port (default `4317`).
- `ARCHITECT_LOCAL_LLM_BASE_URL`: local inference API base URL (default `http://127.0.0.1:11434/v1`).
- `ARCHITECT_LOCAL_LLM_API_KEY`: optional upstream bearer token, never returned by the API.

Example:

```bash
curl http://127.0.0.1:4317/v1/models
curl http://127.0.0.1:4317/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"Explain event sourcing briefly."}]}'
```

The local API validates Host and Origin, limits request bodies to 1 MB, and only permits a loopback inference endpoint. The desktop's existing Agent permission model remains separate: this API is a local model gateway, not a way to bypass workspace or tool permissions.
