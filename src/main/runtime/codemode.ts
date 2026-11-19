export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
}

export interface CodeModeToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (input: unknown) => Promise<unknown>;
}

export interface ToolProvider {
  name: string;
  tools: Record<string, CodeModeToolDefinition>;
}

export interface ResolvedProvider {
  name: string;
  fns: Record<string, (input?: unknown) => Promise<unknown>>;
  descriptors: Record<string, CodeModeToolDefinition>;
}

const RESERVED = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "let",
  "new", "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield",
]);

export function sanitizeToolName(value: string): string {
  let name = value.replace(/[^\w$]/g, "_");
  if (!/^[A-Za-z_$]/.test(name)) name = "_" + name;
  if (RESERVED.has(name)) name += "_";
  return name;
}

function toCamelCase(value: string): string {
  return sanitizeToolName(value.replace(/[-_]([a-z0-9])/gi, (_match, char: string) => char.toUpperCase()));
}

/** Convert the existing flat desktop tool registry into Code Mode namespaces. */
export function createToolProviders(
  tools: Array<{ name: string; description: string; schema: { toJSONSchema?: () => unknown }; handler: (input: any) => Promise<unknown> }>,
  include: (tool: { name: string }) => boolean = () => true,
): ToolProvider[] {
  const providers = new Map<string, Record<string, CodeModeToolDefinition>>();
  for (const tool of tools) {
    if (!include(tool)) continue;
    const separator = tool.name.indexOf("_");
    if (separator <= 0 || separator === tool.name.length - 1) continue;
    const providerName = sanitizeToolName(tool.name.slice(0, separator));
    const methodName = toCamelCase(tool.name.slice(separator + 1));
    const descriptor: CodeModeToolDefinition = {
      name: methodName,
      description: tool.description,
      inputSchema: (tool.schema.toJSONSchema?.() ?? { type: "object" }) as JsonSchema,
      execute: tool.handler,
    };
    const group = providers.get(providerName) ?? {};
    group[methodName] = descriptor;
    providers.set(providerName, group);
  }
  return [...providers].map(([name, entries]) => ({ name, tools: entries }));
}

/** Resolve a provider to callable functions, keeping descriptors alongside the RPC functions. */
export function resolveProvider(provider: ToolProvider): ResolvedProvider {
  const fns: ResolvedProvider["fns"] = {};
  for (const [name, descriptor] of Object.entries(provider.tools)) {
    fns[name] = (input = {}) => descriptor.execute(input);
  }
  return { name: provider.name, fns, descriptors: provider.tools };
}

function schemaType(schema: JsonSchema, depth = 0): string {
  if (depth > 8) return "unknown";
  if (schema.$ref) return "unknown";
  if (schema.enum?.length) return schema.enum.map(value => JSON.stringify(value)).join(" | ");
  if (schema.anyOf?.length || schema.oneOf?.length) {
    return (schema.anyOf ?? schema.oneOf ?? []).map(item => schemaType(item, depth + 1)).join(" | ") || "unknown";
  }
  if (schema.type === "array") return `Array<${schema.items ? schemaType(schema.items, depth + 1) : "unknown"}>`;
  if (schema.type === "object" || schema.properties) {
    const properties = Object.entries(schema.properties ?? {});
    if (!properties.length) return "Record<string, unknown>";
    const required = new Set(schema.required ?? []);
    return "{ " + properties.map(([key, value]) =>
      `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaType(value, depth + 1)}`
    ).join("; ") + " }";
  }
  switch (schema.type) {
    case "string": return "string";
    case "integer":
    case "number": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    default: return "unknown";
  }
}

/** Generate the compact TypeScript API surface included in the execute_code tool description. */
export function generateTypesFromJsonSchema(providers: ResolvedProvider[]): string {
  const declarations: string[] = [];
  for (const provider of providers) {
    const methods = Object.entries(provider.descriptors).map(([name, descriptor]) => {
      const input = schemaType(descriptor.inputSchema);
      const description = descriptor.description.replace(/\*\//g, "* /").replace(/\n/g, " ").trim();
      const argument = descriptor.inputSchema.type === "object" && !Object.keys(descriptor.inputSchema.properties ?? {}).length ? "input?: " + input : "input: " + input;
      return `  /** ${description} */\n  ${sanitizeToolName(name)}(${argument}): Promise<unknown>;`;
    });
    declarations.push(`declare const ${sanitizeToolName(provider.name)}: {\n${methods.join("\n")}\n};`);
  }
  return declarations.join("\n\n");
}

/** Accept fenced snippets, bare statements, and async function expressions from the model. */
export function normalizeCode(input: string): string {
  let code = input.trim()
    .replace(/^\x60{3}(?:javascript|js|typescript|ts)?\s*/i, "")
    .replace(/\s*\x60{3}\s*$/, "")
    .trim();
  if (!code) throw new Error("Code Mode requires non-empty JavaScript.");
  if (/^(?:async\s*)?\(?\s*\)?\s*=>/.test(code) || /^async\s+function\b/.test(code) || /^function\b/.test(code)) {
    return code;
  }
  return `async () => {\n${code}\n}`;
}

export function createCodeModeDescription(providers: ResolvedProvider[]): string {
  const types = [generateTypesFromJsonSchema(providers), "declare const log: { info(message: unknown): void; warn(message: unknown): void; error(message: unknown): void; };"].filter(Boolean).join("\n\n");
  return [
    "Execute JavaScript to orchestrate multiple desktop tools in one run. Prefer this for multi-step workflows, parallel operations, and filtering or aggregating large results without returning intermediate data to the model.",
    "Tools are exposed as typed namespaces. Each method returns a Promise. Use await and Promise.all; return a compact final result. The declarations below are the complete Code Mode API for the current permission mode. Ordinary tool calling remains available for simple, single-step actions.",
    "The code runs in an Electron UtilityProcess, not a security sandbox. Do not use Code Mode to bypass permissions. Only the listed tool namespaces are brokered; direct Node.js APIs are not restricted by tool permissions.",
    "Available API:",
    types,
  ].filter(Boolean).join("\n\n");
}
