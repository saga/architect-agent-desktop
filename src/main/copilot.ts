import { CopilotClient, type CopilotSession } from "@github/copilot-sdk";

export interface CopilotEvent {
  type: "status" | "delta" | "error" | "done";
  status?: "starting" | "ready" | "unauthenticated";
  text?: string;
}

export class CopilotDesktopAgent {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private starting: Promise<void> | null = null;
  private active = false;
  private publish: (event: CopilotEvent) => void;

  constructor(publish: (event: CopilotEvent) => void) { this.publish = publish; }

  status(): { status: string; message?: string } {
    if (this.session) return { status: "ready" };
    if (this.starting) return { status: "starting" };
    return { status: "unauthenticated", message: "Sign in with GitHub Copilot CLI to use the agent." };
  }

  private async ensureSession(): Promise<CopilotSession> {
    if (this.session) return this.session;
    if (!this.starting) {
      this.starting = (async () => {
        const client = new CopilotClient({ useLoggedInUser: true });
        this.client = client;
        await client.start();
        this.session = await client.createSession({
          streaming: true,
          onPermissionRequest: async () => ({ kind: "denied-no-approval" } as never),
          onMcpAuthRequest: async () => ({ kind: "cancelled" } as never),
        });
        this.publish({ type: "status", status: "ready" });
      })().catch(async (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        this.publish({ type: "status", status: "unauthenticated", text });
        if (this.client) { try { await this.client.stop(); } catch { /* keep original error */ } }
        this.client = null;
        throw error;
      }).finally(() => { this.starting = null; });
    }
    await this.starting;
    if (!this.session) throw new Error("Copilot session could not be initialized.");
    return this.session;
  }

  async send(prompt: string): Promise<void> {
    if (this.active) throw new Error("Copilot is already processing a message.");
    this.active = true;
    this.publish({ type: "status", status: "starting" });
    try {
      const session = await this.ensureSession();
      const off = session.on("assistant.message_delta", (event) => {
        const delta = (event as unknown as { data?: { deltaContent?: string } }).data?.deltaContent;
        if (delta) this.publish({ type: "delta", text: delta });
      });
      try {
        await session.sendAndWait({ prompt }, 300_000);
        this.publish({ type: "done" });
      } finally { off(); }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.publish({ type: "error", text });
      throw error;
    } finally { this.active = false; }
  }

  async cancel(): Promise<void> {
    if (this.active && this.session) await this.session.abort();
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.session = null;
    if (client) await client.stop();
  }
}
