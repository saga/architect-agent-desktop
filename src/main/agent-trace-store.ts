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

const SECRET_KEY = /authorization|proxy[_-]?authorization|(^|[_-])(?:access|refresh|id)?[_-]?token($|[_-])|api[_-]?key|x[_-]?api[_-]?key|password|passwd|secret|cookie|credential|private[_-]?key|subscription[_-]?key/i;
const SECRET_ASSIGNMENT = /(["']?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|passwd|secret|private[_-]?key|credential|subscription[_-]?key)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^&\s,;}]+)/gi;
const SENSITIVE_HEADER = /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]+/gi;
const BEARER = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi;
const PEM_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi;
const URL_CREDENTIALS = /(\bhttps?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const COMMON_TOKENS = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

function redactString(value: string): string {
  return value
    .replace(PEM_PRIVATE_KEY, "[REDACTED PRIVATE KEY]")
    .replace(BEARER, "[REDACTED]")
    .replace(SENSITIVE_HEADER, "[REDACTED HEADER]")
    .replace(SECRET_ASSIGNMENT, (_match, prefix: string, raw: string) => {
      const quote = raw[0] === String.fromCharCode(34) || raw[0] === "'" ? raw[0] : "";
      return prefix + (quote ? quote + "[REDACTED]" + quote : "[REDACTED]");
    })
    .replace(URL_CREDENTIALS, "$1[REDACTED]@")
    .replace(COMMON_TOKENS, "[REDACTED TOKEN]");
}

function redact(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
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
      CREATE TABLE IF NOT EXISTS session_messages (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_state TEXT,
        created_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_messages_order ON session_messages(session_id, created_at, id);
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
    let payloadComplete = true;
    try { serialized = JSON.stringify(safe) ?? "null"; }
    catch { serialized = JSON.stringify({ payloadOmitted: true, reason: "event payload could not be serialized" }); payloadComplete = false; }
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

  query(input: { sessionId?: string; traceId?: string; type?: string; limit?: number } = {}): Array<Record<string, unknown>> {
    if (!this.database) throw new Error("Agent trace store is closed.");
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (input.sessionId) { clauses.push("session_id = ?"); values.push(input.sessionId); }
    if (input.traceId) { clauses.push("trace_id = ?"); values.push(input.traceId); }
    if (input.type) { clauses.push("type = ?"); values.push(input.type); }
    const limit = Math.max(1, Math.min(1000, Math.floor(input.limit ?? 200)));
    const rows = this.database.prepare(
      "SELECT id, session_id AS sessionId, trace_id AS traceId, sequence, timestamp, workspace_path AS workspacePath, provider, model, type, status, payload_complete AS payloadComplete, data_json AS dataJson FROM agent_events " +
      (clauses.length ? "WHERE " + clauses.join(" AND ") + " " : "") + "ORDER BY timestamp DESC, sequence DESC LIMIT ?"
    ).all(...values, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row, payloadComplete: row.payloadComplete === 1, data: JSON.parse(String(row.dataJson)), dataJson: undefined }));
  }

  saveSessionItems(sessionId: string, workspacePath: string | null, items: Array<{ id: string; kind: string; content: string; toolName?: string; toolState?: string; createdAt: number }>): void {
    if (!this.database) throw new Error("Agent trace store is closed.");
    const timestamp = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO sessions (id, workspace_path, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET workspace_path=excluded.workspace_path, updated_at=excluded.updated_at
      `).run(sessionId, workspacePath, timestamp, timestamp);
      const upsert = this.database.prepare(`
        INSERT INTO session_messages (session_id, id, kind, content, tool_name, tool_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, id) DO UPDATE SET
          kind=excluded.kind, content=excluded.content, tool_name=excluded.tool_name,
          tool_state=excluded.tool_state, created_at=excluded.created_at, updated_at=excluded.updated_at
        WHERE kind IS NOT excluded.kind OR content IS NOT excluded.content
          OR tool_name IS NOT excluded.tool_name OR tool_state IS NOT excluded.tool_state
          OR created_at IS NOT excluded.created_at
      `);
      for (const item of items) {
        upsert.run(sessionId, item.id, item.kind, String(redact(item.content)), item.toolName ?? null,
          item.toolState ?? null, item.createdAt, timestamp);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listSessionItems(sessionId: string, limit = 50000): Array<Record<string, unknown>> {
    if (!this.database) throw new Error("Agent trace store is closed.");
    const safeLimit = Math.max(1, Math.min(50000, Math.floor(limit)));
    return this.database.prepare(`
      SELECT id, kind, content, tool_name AS toolName, tool_state AS toolState, created_at AS createdAt
      FROM session_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?
    `).all(sessionId, safeLimit) as Array<Record<string, unknown>>;
  }

  clearSessionItems(sessionId: string): void {
    if (!this.database) throw new Error("Agent trace store is closed.");
    this.database.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
  }

  listSessions(limit = 100): Array<Record<string, unknown>> {
    if (!this.database) throw new Error("Agent trace store is closed.");
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.database.prepare(`
      SELECT s.id, s.workspace_path AS workspacePath, s.created_at AS createdAt, s.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = s.id) AS messageCount,
        (SELECT COUNT(*) FROM agent_events e WHERE e.session_id = s.id) AS eventCount
      FROM sessions s ORDER BY s.updated_at DESC LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }
}
