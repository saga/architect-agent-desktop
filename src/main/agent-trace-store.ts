import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface AgentTraceInput {
  sessionId: string;
  traceId: string;
  workspacePath: string | null;
  provider?: string;
  model?: string;
  type: string;
  status?: string;
  data?: unknown;
  timestamp?: string;
}

const SECRET_KEY = /authorization|(^|[_-])token($|[_-])|api[_-]?key|password|secret|cookie|credential|private[_-]?key/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

function redact(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(BEARER, "Bearer [REDACTED]");
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redact(item, "", seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redact(item, name, seen)]));
  }
  return value;
}

export class AgentTraceStore {
  private database: DatabaseSync | null = null;
  private directory: string;

  constructor(directory: string) {
    this.directory = path.resolve(directory);
    this.open();
  }

  private open(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const filename = path.join(this.directory, "agent-traces.sqlite");
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        workspace_path TEXT,
        provider TEXT,
        model TEXT,
        type TEXT NOT NULL,
        status TEXT,
        payload_complete INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_events_session_time ON agent_events(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_agent_events_trace_sequence ON agent_events(trace_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_agent_events_type_time ON agent_events(type, timestamp);
    `);
    try { chmodSync(filename, 0o600); } catch { /* Platform permissions may differ. */ }
  }

  setDirectory(directory: string): void {
    const next = path.resolve(directory);
    if (next === this.directory) return;
    this.close();
    this.directory = next;
    this.open();
  }

  getDirectory(): string { return this.directory; }

  record(input: AgentTraceInput): void {
    if (!this.database) throw new Error("Agent trace store is closed.");
    const timestamp = input.timestamp ?? new Date().toISOString();
    const safe = redact(input.data ?? null);
    let serialized: string;
    try { serialized = JSON.stringify(safe) ?? "null"; }
    catch { serialized = JSON.stringify({ payloadOmitted: true, reason: "event payload could not be serialized" }); }
    let payloadComplete = true;
    if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
      serialized = JSON.stringify({
        payloadOmitted: true,
        reason: "event payload exceeded the 1 MiB limit",
        preview: serialized.slice(0, 4000),
      });
      payloadComplete = false;
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO sessions (id, workspace_path, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET workspace_path=excluded.workspace_path, updated_at=excluded.updated_at
      `).run(input.sessionId, input.workspacePath, timestamp, timestamp);
      const row = this.database.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM agent_events WHERE trace_id = ?").get(input.traceId) as { next: number };
      this.database.prepare(`
        INSERT INTO agent_events
          (id, session_id, trace_id, sequence, timestamp, workspace_path, provider, model, type, status, payload_complete, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), input.sessionId, input.traceId, Number(row.next), timestamp, input.workspacePath,
        input.provider ?? null, input.model ?? null, input.type, input.status ?? null, payloadComplete ? 1 : 0, serialized);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }
}
