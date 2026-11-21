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
  private readonly surfacesBySession = new Map<string, Set<string>>();

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
      feed: (chunk) => this.trackSurfaceMessages(sessionId, normalizeParts(stream.feed(chunk))),
      close: () => this.trackSurfaceMessages(sessionId, normalizeParts(stream.close())),
      parse: (content) => this.trackSurfaceMessages(sessionId, normalizeParts(processor.parseResponse(content, { state, wrapped: true }))),
    };
  }

  async validateRendererMessage(message: unknown, sessionId: string): Promise<{ handled: false; replies: AgentToRendererMessage[] }> {
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
    const sessionKey = sessionId.trim() || "__default_agent_session__";
    if (!this.surfacesBySession.get(sessionKey)?.has(action.surfaceId)) {
      throw new Error("A2UI ActionMessage references a Surface that was not created in this Agent Task.");
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

  registerSurfaces(sessionId: string, surfaceIds: string[]): void {
    const key = sessionId.trim() || "__default_agent_session__";
    if (!Array.isArray(surfaceIds) || surfaceIds.length > 100) {
      throw new Error("A2UI Task Surface registration exceeds 100 IDs.");
    }
    const ids = new Set<string>();
    for (const id of surfaceIds) {
      if (typeof id !== "string" || id.length < 1 || id.length > 120) {
        throw new Error("A2UI Surface ID is invalid.");
      }
      ids.add(id);
    }
    this.stateFor(key);
    this.surfacesBySession.set(key, ids);
  }

  reset(sessionId: string): void {
    const key = sessionId.trim() || "__default_agent_session__";
    this.states.delete(key);
    this.surfacesBySession.delete(key);
  }

  private trackSurfaceMessages(sessionId: string, parts: A2UIPart[]): A2UIPart[] {
    const key = sessionId.trim() || "__default_agent_session__";
    let surfaces = this.surfacesBySession.get(key);
    if (!surfaces) {
      surfaces = new Set<string>();
      this.surfacesBySession.set(key, surfaces);
    }
    for (const part of parts) {
      if (part.type !== "a2ui") continue;
      for (const raw of part.messages) {
        if (!raw || typeof raw !== "object") continue;
        const message = raw as Record<string, unknown>;
        const create = message.createSurface;
        if (create && typeof create === "object" && !Array.isArray(create)) {
          const surfaceId = (create as Record<string, unknown>).surfaceId;
          if (typeof surfaceId === "string" && surfaceId.length <= 120) surfaces.add(surfaceId);
        }
        const remove = message.deleteSurface;
        if (remove && typeof remove === "object" && !Array.isArray(remove)) {
          const surfaceId = (remove as Record<string, unknown>).surfaceId;
          if (typeof surfaceId === "string") surfaces.delete(surfaceId);
        }
      }
    }
    if (surfaces.size > 100) {
      const oldest = [...surfaces].slice(0, surfaces.size - 100);
      for (const surfaceId of oldest) surfaces.delete(surfaceId);
    }
    if (this.states.size > 64) {
      const oldestSession = this.states.keys().next().value;
      if (oldestSession && oldestSession !== key) this.reset(oldestSession);
    }
    return parts;
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
