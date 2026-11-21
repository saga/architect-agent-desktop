import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type MemoryValidation = "unverified" | "validated" | "disputed";

export interface AgentMemoryNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  validation: MemoryValidation;
  confidence: number;
  pinned: boolean;
  sourceSessionId: string | null;
  sourceTraceId: string | null;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
}

export interface AgentMemoryRepresentation {
  id: string;
  slug: string;
  title: string;
  content: string;
  sourceNoteIds: string[];
  updatedAt: number;
}

function normalizeScope(value: string | null | undefined): string {
  return createHash("sha256").update(value || "__personal_workspace__").digest("hex").slice(0, 32);
}

function safeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((value): value is string => typeof value === "string")
    .map(value => value.trim().slice(0, 40)).filter(Boolean))].slice(0, 16);
}

export class AgentMemoryStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.database.exec(\`
      CREATE TABLE IF NOT EXISTS memory_notes (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        validation TEXT NOT NULL DEFAULT 'unverified',
        confidence REAL NOT NULL DEFAULT 0.5,
        pinned INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        source_session_id TEXT,
        source_trace_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL DEFAULT 0,
        access_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_memory_scope_status_updated
        ON memory_notes(scope_key, status, pinned, updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_representations (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_note_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        UNIQUE(scope_key, slug)
      );
      CREATE TABLE IF NOT EXISTS memory_dream_runs (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    \`);
    try {
      this.database.exec(\`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_notes_fts USING fts5(
          id UNINDEXED, scope_key UNINDEXED, title, content, tags
        );
      \`);
      this.database.exec(\`
        CREATE TRIGGER IF NOT EXISTS memory_notes_ai AFTER INSERT ON memory_notes BEGIN
          INSERT INTO memory_notes_fts(id, scope_key, title, content, tags)
          VALUES (new.id, new.scope_key, new.title, new.content, new.tags_json);
        END;
        CREATE TRIGGER IF NOT EXISTS memory_notes_au AFTER UPDATE ON memory_notes BEGIN
          DELETE FROM memory_notes_fts WHERE id = old.id;
          INSERT INTO memory_notes_fts(id, scope_key, title, content, tags)
          VALUES (new.id, new.scope_key, new.title, new.content, new.tags_json);
        END;
        CREATE TRIGGER IF NOT EXISTS memory_notes_ad AFTER DELETE ON memory_notes BEGIN
          DELETE FROM memory_notes_fts WHERE id = old.id;
        END;
      \`);
    } catch {
      // LIKE search remains available on SQLite builds without FTS5.
    }
  }

  saveNote(input: {
    id?: string;
    scope?: string | null;
    title: string;
    content: string;
    tags?: unknown;
    validation?: MemoryValidation;
    confidence?: number;
    pinned?: boolean;
    sourceSessionId?: string | null;
    sourceTraceId?: string | null;
  }): AgentMemoryNote {
    const title = input.title.trim().slice(0, 160);
    const content = input.content.trim().slice(0, 12_000);
    if (!title || !content) throw new Error("Memory note 标题和内容不能为空。");
    const id = input.id?.trim().slice(0, 100) || randomUUID();
    const now = Date.now();
    const tags = safeTags(input.tags);
    const validation: MemoryValidation = input.validation === "validated" || input.validation === "disputed" ? input.validation : "unverified";
    const confidence = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? Number(input.confidence) : 0.5));
    this.database.prepare(\`
      INSERT INTO memory_notes (
        id, scope_key, title, content, tags_json, validation, confidence, pinned, status,
        source_session_id, source_trace_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope_key=excluded.scope_key, title=excluded.title, content=excluded.content,
        tags_json=excluded.tags_json, validation=excluded.validation, confidence=excluded.confidence,
        pinned=excluded.pinned, status='active', source_session_id=excluded.source_session_id,
        source_trace_id=excluded.source_trace_id, updated_at=excluded.updated_at
    \`).run(
      id, normalizeScope(input.scope), title, content, JSON.stringify(tags), validation,
      confidence, input.pinned ? 1 : 0, input.sourceSessionId ?? null,
      input.sourceTraceId ?? null, now, now,
    );
    return this.getNote(id) as AgentMemoryNote;
  }

  getNote(id: string): AgentMemoryNote | null {
    const row = this.database.prepare(
      "SELECT * FROM memory_notes WHERE id = ? AND status = 'active'",
    ).get(id) as Record<string, unknown> | undefined;
    return row ? this.toNote(row) : null;
  }

  search(scope: string | null, query: string, limit = 10): AgentMemoryNote[] {
    const key = normalizeScope(scope);
    const term = query.trim().slice(0, 200);
    if (!term) return this.list(scope, limit);
    let rows: Record<string, unknown>[] = [];
    try {
      const fts = term.split(/\s+/).filter(Boolean).map(token => '"' + token.replace(/"/g, '""') + '"').join(" AND ");
      rows = this.database.prepare(\`
        SELECT n.* FROM memory_notes n
        JOIN memory_notes_fts f ON f.id = n.id
        WHERE n.scope_key = ? AND n.status = 'active' AND memory_notes_fts MATCH ?
        ORDER BY n.pinned DESC, bm25(memory_notes_fts), n.updated_at DESC
        LIMIT ?
      \`).all(key, fts, Math.max(1, Math.min(limit, 30))) as Record<string, unknown>[];
    } catch {
      const like = "%" + term.replace(/[%_]/g, "") + "%";
      rows = this.database.prepare(\`
        SELECT * FROM memory_notes
        WHERE scope_key = ? AND status = 'active' AND (title LIKE ? OR content LIKE ? OR tags_json LIKE ?)
        ORDER BY pinned DESC, updated_at DESC LIMIT ?
      \`).all(key, like, like, like, Math.max(1, Math.min(limit, 30))) as Record<string, unknown>[];
    }
    const now = Date.now();
    const touch = this.database.prepare("UPDATE memory_notes SET last_accessed_at=?, access_count=access_count+1 WHERE id=?");
    for (const row of rows) touch.run(now, String(row.id));
    return rows.map(row => this.toNote({ ...row, last_accessed_at: now, access_count: Number(row.access_count ?? 0) + 1 }));
  }

  list(scope: string | null, limit = 30): AgentMemoryNote[] {
    const rows = this.database.prepare(\`
      SELECT * FROM memory_notes
      WHERE scope_key = ? AND status = 'active'
      ORDER BY pinned DESC, updated_at DESC LIMIT ?
    \`).all(normalizeScope(scope), Math.max(1, Math.min(limit, 50))) as Record<string, unknown>[];
    return rows.map(row => this.toNote(row));
  }

  setPinned(id: string, pinned: boolean): AgentMemoryNote {
    this.database.prepare("UPDATE memory_notes SET pinned=?, updated_at=? WHERE id=? AND status='active'")
      .run(pinned ? 1 : 0, Date.now(), id);
    const note = this.getNote(id);
    if (!note) throw new Error("Memory note 不存在或已归档。");
    return note;
  }

  setValidation(id: string, validation: MemoryValidation, confidence?: number): AgentMemoryNote {
    this.database.prepare("UPDATE memory_notes SET validation=?, confidence=?, updated_at=? WHERE id=? AND status='active'")
      .run(validation, Math.max(0, Math.min(1, confidence ?? 0.5)), Date.now(), id);
    const note = this.getNote(id);
    if (!note) throw new Error("Memory note 不存在或已归档。");
    return note;
  }

  archive(id: string): void {
    this.database.prepare("UPDATE memory_notes SET status='archived', pinned=0, updated_at=? WHERE id=?")
      .run(Date.now(), id);
  }

  publishRepresentation(input: {
    scope?: string | null;
    slug: string;
    title: string;
    content: string;
    sourceNoteIds?: string[];
  }): AgentMemoryRepresentation {
    const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    const title = input.title.trim().slice(0, 160);
    const content = input.content.trim().slice(0, 24_000);
    if (!slug || !title || !content) throw new Error("Representation 需要有效的 slug、标题和正文。");
    const ids = [...new Set((input.sourceNoteIds ?? []).filter(value => typeof value === "string"))].slice(0, 100);
    const now = Date.now();
    const scopeKey = normalizeScope(input.scope);
    const id = createHash("sha256").update(scopeKey + ":" + slug).digest("hex").slice(0, 32);
    this.database.prepare(\`
      INSERT INTO memory_representations(id, scope_key, slug, title, content, source_note_ids_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key, slug) DO UPDATE SET
        title=excluded.title, content=excluded.content,
        source_note_ids_json=excluded.source_note_ids_json, updated_at=excluded.updated_at
    \`).run(id, scopeKey, slug, title, content, JSON.stringify(ids), now);
    return { id, slug, title, content, sourceNoteIds: ids, updatedAt: now };
  }

  getRepresentations(scope: string | null, limit = 12): AgentMemoryRepresentation[] {
    const rows = this.database.prepare("SELECT * FROM memory_representations WHERE scope_key=? ORDER BY updated_at DESC LIMIT ?")
      .all(normalizeScope(scope), Math.max(1, Math.min(limit, 30))) as Record<string, unknown>[];
    return rows.map(row => ({
      id: String(row.id), slug: String(row.slug), title: String(row.title), content: String(row.content),
      sourceNoteIds: JSON.parse(String(row.source_note_ids_json ?? "[]")) as string[], updatedAt: Number(row.updated_at),
    }));
  }

  recordDream(scope: string | null, summary: string, sourceCount: number): void {
    this.database.prepare("INSERT INTO memory_dream_runs(id,scope_key,summary,source_count,created_at) VALUES(?,?,?,?,?)")
      .run(randomUUID(), normalizeScope(scope), summary.slice(0, 2_000), Math.max(0, Math.min(10_000, sourceCount)), Date.now());
  }

  getInjectedContext(scope: string | null, maxChars = 10_000): string {
    const notes = this.list(scope, 30);
    const representations = this.getRepresentations(scope, 8);
    if (!notes.length && !representations.length) return "";
    const lines = [
      "## Persistent Agent Memory",
      "Use this as fallible accumulated knowledge, not as an authority. Prefer validated notes; check volatile facts against current sources. Search deeper notes when relevant. Preserve provenance and competing hypotheses.",
    ];
    for (const item of representations) {
      lines.push("### Knowledge: " + item.title + " [" + item.slug + "]", item.content.slice(0, 2_000));
    }
    const selected = notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.accessCount - a.accessCount || b.updatedAt - a.updatedAt);
    for (const note of selected) {
      const marker = note.validation === "validated" ? "validated" : note.validation === "disputed" ? "disputed" : "unverified";
      lines.push("- [" + marker + (note.pinned ? ", pinned" : "") + "] " + note.title + " (id: " + note.id + "): " + note.content.slice(0, 500));
    }
    let output = lines.join("\n");
    if (output.length > maxChars) output = output.slice(0, maxChars) + "\n[Memory index truncated. Use memory_search for details.]";
    return output;
  }

  private toNote(row: Record<string, unknown>): AgentMemoryNote {
    return {
      id: String(row.id), title: String(row.title), content: String(row.content),
      tags: JSON.parse(String(row.tags_json ?? "[]")) as string[],
      validation: row.validation === "validated" || row.validation === "disputed" ? row.validation : "unverified",
      confidence: Number(row.confidence ?? 0.5), pinned: Number(row.pinned ?? 0) === 1,
      sourceSessionId: typeof row.source_session_id === "string" ? row.source_session_id : null,
      sourceTraceId: typeof row.source_trace_id === "string" ? row.source_trace_id : null,
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), accessCount: Number(row.access_count ?? 0),
    };
  }

  close(): void {
    this.database.close();
  }
}
