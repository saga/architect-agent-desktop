import {
  A2uiGenerator,
  CatalogConfig,
  RendererState,
} from "@a2ui/agent";
import type { AgentToRendererMessage } from "@a2ui/agent";
import { createAgentFinanceCatalog, FINANCE_A2UI_CATALOG_ID } from "../shared/a2ui-finance-catalog.mjs";

export type A2UIPart =
  | { type: "text"; text: string }
  | { type: "a2ui"; messages: AgentToRendererMessage[] };

export interface A2UITurn {
  promptSnippet: string;
  feed(chunk: string): A2UIPart[];
  close(): A2UIPart[];
  parse(content: string): A2UIPart[];
}

function normalizeParts(parts: unknown[]): A2UIPart[] {
  const output: A2UIPart[] = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as { type?: string; text?: string; a2ui?: AgentToRendererMessage[] };
    if (part.type === "text" && typeof part.text === "string") {
      output.push({ type: "text", text: part.text });
    } else if (part.type === "a2ui" && Array.isArray(part.a2ui)) {
      output.push({ type: "a2ui", messages: part.a2ui });
    }
  }
  return output;
}

/**
 * Keeps A2UI renderer state per Agent Task session. A processor is request-scoped,
 * while the RendererState survives across turns so a canvas can safely update a
 * Surface created by an earlier turn.
 */
export class AgentA2UIService {
  private readonly catalog = createAgentFinanceCatalog();
  private readonly generator = new A2uiGenerator([new CatalogConfig(this.catalog)]);
  private readonly states = new Map<string, RendererState>();

  promptSnippet(sessionId: string): string {
    const processor = this.generator.createProcessor(
      { "1.0": { supportedCatalogIds: [FINANCE_A2UI_CATALOG_ID] } },
      undefined,
      { state: this.stateFor(sessionId) },
    );
    return processor.promptSnippet;
  }

  createTurn(sessionId: string): A2UITurn {
    const state = this.stateFor(sessionId);
    const processor = this.generator.createProcessor(
      { "1.0": { supportedCatalogIds: [FINANCE_A2UI_CATALOG_ID] } },
      undefined,
      { state },
    );
    const stream = processor.openStream({ state, wrapped: true });
    return {
      promptSnippet: processor.promptSnippet,
      feed: (chunk) => normalizeParts(stream.feed(chunk)),
      close: () => normalizeParts(stream.close()),
      parse: (content) => normalizeParts(processor.parseResponse(content, { state, wrapped: true })),
    };
  }

  async validateRendererMessage(message: unknown): Promise<{ handled: false; replies: AgentToRendererMessage[] }> {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new Error("A2UI ActionMessage must be an object.");
    }
    const envelope = message as Record<string, unknown>;
    if (envelope.version !== "1.0" || !envelope.action || typeof envelope.action !== "object" || Array.isArray(envelope.action)) {
      throw new Error("A2UI ActionMessage must use protocol version 1.0.");
    }
    const action = envelope.action as Record<string, unknown>;
    if (typeof action.name !== "string" || action.name.length < 1 || action.name.length > 120) {
      throw new Error("A2UI ActionMessage action.name is invalid.");
    }
    if (typeof action.surfaceId !== "string" || action.surfaceId.length < 1 || action.surfaceId.length > 120) {
      throw new Error("A2UI ActionMessage action.surfaceId is invalid.");
    }
    if (action.sourceComponentId !== undefined &&
        (typeof action.sourceComponentId !== "string" || action.sourceComponentId.length > 120)) {
      throw new Error("A2UI ActionMessage sourceComponentId is invalid.");
    }
    if (Buffer.byteLength(JSON.stringify(message), "utf8") > 32 * 1024) {
      throw new Error("A2UI ActionMessage exceeds the 32 KiB limit.");
    }
    // Renderer actions are user input. Validate only the protocol envelope here;
    // the Agent interprets them as untrusted context and still uses Tool Broker.
    return { handled: false, replies: [] };
  }

  reset(sessionId: string): void {
    this.states.delete(sessionId);
  }

  private stateFor(sessionId: string): RendererState {
    const key = sessionId.trim() || "__default_agent_session__";
    let state = this.states.get(key);
    if (!state) {
      state = new RendererState([this.catalog]);
      this.states.set(key, state);
    }
    return state;
  }
}
