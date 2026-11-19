import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

export interface CatalogModel {
  id: string;
  credits: number | null;
}

export const DEFAULT_MODEL_ID = "deepseek-v4.1-flash";
export const MODEL_PREFERENCE = [DEFAULT_MODEL_ID, "hy4free"] as const;
export const HY4_MODEL_IDS = ["hy4free"] as const;
export const DEFAULT_CONFIG_PATH = "novel-generation.config.json";

export function parseCredits(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const match = /^x?\s*(-?\d+(?:\.\d+)?)/i.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function modelsFromConfig(raw: unknown): CatalogModel[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { models?: unknown }).models;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown): CatalogModel[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as { id?: unknown; credits?: unknown };
    const id = typeof record.id === "string" ? record.id.trim() : "";
    return id ? [{ id, credits: parseCredits(record.credits) }] : [];
  });
}

export function decodeProductConfig(text: string): CatalogModel[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return []; }
  const direct = modelsFromConfig(parsed);
  if (direct.length) return direct;
  if (typeof parsed !== "string") return [];
  try {
    return modelsFromConfig(JSON.parse(gunzipSync(Buffer.from(parsed, "base64")).toString("utf8")));
  } catch { return []; }
}

function readJsonModels(filePath: string): CatalogModel[] {
  try { return modelsFromConfig(JSON.parse(readFileSync(filePath, "utf8"))); }
  catch { return []; }
}

export interface CatalogOptions {
  localStorageDir?: string;
  userModelsPath?: string;
  projectRoot?: string;
}

export function readModelCatalog(options: CatalogOptions = {}): CatalogModel[] {
  let base: CatalogModel[] = [];
  const configured = (process.env.ACC_PRODUCT_CONFIG_PATH ?? "").trim();
  if (configured) {
    try { base = decodeProductConfig(readFileSync(configured, "utf8").trim()); }
    catch { }
  }
  if (!base.length) {
    const dir = options.localStorageDir ?? join(homedir(), ".codebuddy", "local_storage");
    let files: string[] = [];
    try {
      files = readdirSync(dir)
        .filter(name => name.endsWith(".info"))
        .map(name => {
          const full = join(dir, name);
          try { return { full, mtime: statSync(full).mtimeMs }; }
          catch { return null; }
        })
        .filter((item): item is { full: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .map(item => item.full);
    } catch { }
    for (const file of files) {
      try {
        const models = decodeProductConfig(readFileSync(file, "utf8").trim());
        if (models.length) { base = models; break; }
      } catch { }
    }
  }

  const userModels = readJsonModels(options.userModelsPath ?? join(homedir(), ".codebuddy", "models.json"));
  const projectModels = options.projectRoot
    ? readJsonModels(join(options.projectRoot, ".codebuddy", "models.json"))
    : [];
  const merged = new Map<string, CatalogModel>();
  for (const model of [...base, ...userModels, ...projectModels]) {
    const previous = merged.get(model.id);
    merged.set(model.id, { id: model.id, credits: model.credits ?? previous?.credits ?? null });
  }
  return [...merged.values()];
}

export function expandModelAlias(requested: string, catalog: readonly CatalogModel[]): string[] {
  const ids = HY4_MODEL_IDS.filter(id => requested === "hy4" || id === requested);
  if (!ids.length) return [requested];
  const available = new Map(catalog.map(model => [model.id, model]));
  if (!available.size) return [HY4_MODEL_IDS[0]];
  const found = ids
    .map(id => available.get(id))
    .filter((model): model is CatalogModel => model !== undefined)
    .sort((a, b) => (a.credits ?? Number.POSITIVE_INFINITY) - (b.credits ?? Number.POSITIVE_INFINITY));
  return found.length ? found.map(model => model.id) : [HY4_MODEL_IDS[0]];
}

export function nonAuto(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed && trimmed.toLowerCase() !== "auto" ? trimmed : undefined;
}

export function readConfiguredModel(configPath?: string): string | undefined {
  const path = configPath ?? ((process.env.NOVEL_AGENT_CONFIG ?? "").trim() || resolve(DEFAULT_CONFIG_PATH));
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { model?: unknown };
    return nonAuto(typeof parsed.model === "string" ? parsed.model : undefined);
  } catch { return undefined; }
}

export function resolveAgentModel(
  explicit?: string,
  catalog: readonly CatalogModel[] = readModelCatalog(),
  configPath?: string
): { model: string; fallbacks: string[]; source: "explicit" | "env" | "config" | "default" } {
  const fromExplicit = nonAuto(explicit);
  const fromEnv = nonAuto(process.env.NOVEL_AGENT_MODEL) ?? nonAuto(process.env.CODEBUDDY_DEFAULT_MODEL);
  const requested = fromExplicit ?? fromEnv;
  const configured = requested ? undefined : readConfiguredModel(configPath);
  const chosen = requested ?? configured;
  const source = fromExplicit ? "explicit" : fromEnv ? "env" : configured ? "config" : "default";

  const preferred = MODEL_PREFERENCE
    .map(id => expandModelAlias(id, catalog)[0])
    .filter((id): id is string => Boolean(id));
  const chain = [...new Set(preferred)];
  if (!chain.length) chain.push(DEFAULT_MODEL_ID);
  const model = chosen ? (expandModelAlias(chosen, catalog)[0] ?? chosen) : chain[0]!;
  return { model, fallbacks: chain.filter(id => id !== model), source };
}

export function isManagedSession(): boolean {
  return Boolean(process.env.CODEBUDDY_SESSION_ID || process.env.WORKBUDDY_CONFIG_DIR);
}

export interface QueryOptionsInput {
  cwd: string;
  abortController: AbortController;
  fallbackModel?: string;
  thinking?: { type: "disabled" } | { type: "adaptive" } | { type: "enabled"; budgetTokens: number };
  effort?: "low" | "medium" | "high";
  systemPrompt?: string;
}

export const TEXT_ONLY_SYSTEM_PROMPT = [
  "你是纯文本写作与文本处理接口。",
  "只输出最终结果文本：不调用任何工具，不输出工具调用语法、XML 标签、思考过程、状态说明或创作说明。",
  "任务要求的格式（章节标题、Markdown、纯文本段落）优先于其他一切习惯。"
].join("");

const HOST_SESSION_ENV_KEYS = [
  "CODEBUDDY_SERVICE_PROXY_URL",
  "CODEBUDDY_HOST",
  "CODEBUDDY_SESSION_ID",
  "CODEBUDDY_CONVERSATION_REQUEST_ID",
  "CODEBUDDY_ROOT_REQUEST_ID",
  "WORKBUDDY_CONFIG_DIR",
  "ACC_PRODUCT_CONFIG_PATH"
] as const;

export function detachedCliOptions(): { env: Record<string, string | undefined>; extraArgs: Record<string, string> } {
  const env: Record<string, string | undefined> = {};
  for (const key of HOST_SESSION_ENV_KEYS) env[key] = undefined;
  return { env, extraArgs: { port: "0" } };
}

export function buildQueryOptions(model: string, input: QueryOptionsInput) {
  return {
    ...(model ? { model } : {}),
    ...(input.fallbackModel ? { fallbackModel: input.fallbackModel } : {}),
    cwd: input.cwd,
    ...(isManagedSession() ? detachedCliOptions() : {}),
    systemPrompt: input.systemPrompt ?? TEXT_ONLY_SYSTEM_PROMPT,
    permissionMode: "default" as const,
    settingSources: [],
    persistSession: false,
    thinking: input.thinking ?? { type: "disabled" as const },
    effort: input.effort ?? "low" as const,
    tools: [],
    allowedTools: [],
    maxTurns: 1,
    canUseTool: async (toolName: string) => ({
      behavior: "deny" as const,
      message: "文本分析调用不允许执行工具：" + toolName
    }),
    abortController: input.abortController
  };
}
