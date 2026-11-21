import {
  A2uiGenerator,
  CatalogConfig,
  RendererState,
  RendererToAgentMessageProcessor,
} from "@a2ui/agent";
import type { AgentToRendererMessage, RendererToAgentMessage } from "@a2ui/agent";
import { createAgentFinanceCatalog, FINANCE_A2UI_CATALOG_ID } from "../shared/a2ui-finance-catalog";

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
  return parts.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const part = raw as { type?: string; text?: string; a2ui?: AgentToRendererMessage[] };
    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text" as const, text: part.text }];
    }
    if (part.type === "a2ui" && Array.isArray(part.a2ui)) {
      return [{ type: "a2ui" as const, messages: part.a2ui }];
    }
    return [];
  }) as A2UIPart[];
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

  async validateRendererMessage(message: unknown): Promise<{ handled: boolean; replies: AgentToRendererMessage[] }> {
    const processor = new RendererToAgentMessageProcessor({
      catalogs: [this.catalog],
      // Actions are deliberately left for the model to interpret. Returning false
      // validates the v1.0 envelope but allows the calling app to continue the turn.
      onAction: () => false,
    });
    return processor.processMessage(message);
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
