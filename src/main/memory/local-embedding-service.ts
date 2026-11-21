export interface LocalEmbeddingConfig {
  provider: "disabled" | "ollama";
  baseUrl: string;
  model: string;
}

export interface LocalEmbeddingResult {
  provider: "ollama";
  model: string;
  vector: number[];
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const MAX_INPUT_CHARS = 8_000;
const MAX_VECTOR_DIMENSIONS = 4_096;

export function normalizeLocalEmbeddingConfig(config: Partial<LocalEmbeddingConfig>): LocalEmbeddingConfig {
  const provider = config.provider === "ollama" ? "ollama" : "disabled";
  const model = typeof config.model === "string" ? config.model.trim().slice(0, 120) : "nomic-embed-text";
  const rawUrl = typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_BASE_URL;
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname) ||
      url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("本地 Embedding 服务地址只能是 http://localhost、127.0.0.1 或 ::1，不能配置远程主机。");
  }
  if (provider === "ollama" && !model) throw new Error("启用 Ollama Embedding 时必须填写模型名称。");
  return { provider, baseUrl: url.origin, model: model || "nomic-embed-text" };
}

function normalizeVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 8 || value.length > MAX_VECTOR_DIMENSIONS) {
    throw new Error("Embedding 返回的向量维度无效。");
  }
  const vector = value.map(item => Number(item));
  if (!vector.every(item => Number.isFinite(item))) throw new Error("Embedding 返回了非有限数值。");
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm <= 0) throw new Error("Embedding 返回了零向量。");
  return vector.map(item => item / norm);
}

export class LocalEmbeddingService {
  async embedMany(configInput: LocalEmbeddingConfig, inputs: string[]): Promise<LocalEmbeddingResult[]> {
    const config = normalizeLocalEmbeddingConfig(configInput);
    if (config.provider === "disabled") throw new Error("本地语义检索尚未启用。");
    if (!inputs.length || inputs.length > 32) throw new Error("每批 Embedding 输入数量必须为 1 至 32。");
    const normalizedInputs = inputs.map(value => value.trim().slice(0, MAX_INPUT_CHARS));
    if (normalizedInputs.some(value => !value)) throw new Error("Embedding 输入不能为空。");
    const response = await fetch(config.baseUrl + "/api/embed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, input: normalizedInputs }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Ollama Embedding 请求失败：" + response.status + " " + response.statusText);
    const payload = await response.json() as { model?: unknown; embeddings?: unknown };
    const embeddings = payload.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== normalizedInputs.length) {
      throw new Error("Ollama Embedding 响应数量与输入数量不一致。");
    }
    return embeddings.map(vector => ({
      provider: "ollama" as const,
      model: typeof payload.model === "string" && payload.model.trim() ? payload.model : config.model,
      vector: normalizeVector(vector),
    }));
  }

  async embed(config: LocalEmbeddingConfig, input: string): Promise<LocalEmbeddingResult> {
    const results = await this.embedMany(config, [input]);
    return results[0]!;
  }

  async check(configInput: LocalEmbeddingConfig): Promise<{ available: boolean; model: string; dimensions: number }> {
    const config = normalizeLocalEmbeddingConfig(configInput);
    const result = await this.embed(config, "local embedding connectivity check");
    return { available: true, model: result.model, dimensions: result.vector.length };
  }
}

export const DEFAULT_LOCAL_EMBEDDING_CONFIG: LocalEmbeddingConfig = {
  provider: "disabled",
  baseUrl: DEFAULT_BASE_URL,
  model: "nomic-embed-text",
};
