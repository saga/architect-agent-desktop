import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface AnalyticsQueryResult {
  columns: string[];
  types: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
}

interface DuckDbHandle {
  instance: { closeSync?: () => void };
  connection: {
    run(sql: string, parameters?: Record<string, unknown>): Promise<unknown>;
    runAndReadAll(sql: string): Promise<{
      columnNames(): string[];
      columnTypes(): string[];
      getRowObjectsJson(): Array<Record<string, unknown>>;
    }>;
    closeSync?(): void;
  };
}

const MAX_QUERY_LENGTH = 12_000;
const MAX_QUERY_ROWS = 500;
const FORBIDDEN_SQL = /\b(attach|detach|install|load|copy|export|import|pragma|call|create|alter|drop|delete|update|insert|replace|truncate|vacuum|checkpoint|set|reset|use|read_[a-z0-9_]*|glob|httpfs|sqlite_[a-z0-9_]*|postgres_[a-z0-9_]*|mysql_[a-z0-9_]*|query_table|query|shell|read_text|read_blob|read_csv|read_parquet|read_json|read_ndjson)\b/i;

function identifier(value: string): string {
  const cleaned = value.normalize("NFKD").replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return cleaned || "dataset";
}

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

function sqlType(values: unknown[]): string {
  const present = values.filter(value => value !== null && value !== undefined && value !== "");
  if (!present.length) return "VARCHAR";
  if (present.every(value => typeof value === "boolean")) return "BOOLEAN";
  if (present.every(value => typeof value === "number" && Number.isInteger(value))) return "BIGINT";
  if (present.every(value => typeof value === "number")) return "DECIMAL(38, 10)";
  if (present.every(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?$/.test(value))) return "TIMESTAMP";
  return "VARCHAR";
}

function sqlValue(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return value;
}

export class DuckDbAnalyticsService {
  private readonly handles = new Map<string, Promise<DuckDbHandle>>();

  constructor(private readonly dataDirectory: string) {}

  private async connection(scope: string): Promise<DuckDbHandle> {
    const key = createHash("sha256").update(scope || "personal").digest("hex").slice(0, 24);
    let pending = this.handles.get(key);
    if (!pending) {
      pending = (async () => {
        await mkdir(this.dataDirectory, { recursive: true });
        const { DuckDBInstance } = await import("@duckdb/node-api");
        const databasePath = path.join(this.dataDirectory, key + ".duckdb");
        const instance = await DuckDBInstance.create(databasePath, {
          threads: "2",
          memory_limit: "1GB",
          max_temp_directory_size: "512MB",
          enable_external_access: "false",
          autoload_known_extensions: "false",
          autoinstall_known_extensions: "false",
        });
        const connection = await instance.connect();
        return { instance, connection } as DuckDbHandle;
      })();
      this.handles.set(key, pending);
      pending.catch(() => this.handles.delete(key));
    }
    return pending;
  }

  async importRows(scope: string, datasetName: string, columns: string[], rows: unknown[][]): Promise<{ table: string; rowCount: number; truncated: boolean }> {
    if (!columns.length || columns.length > 100) throw new Error("表格必须包含 1–100 个字段。");
    if (!rows.length) throw new Error("表格没有可导入的数据行。");
    if (rows.length > 50_000) throw new Error("单个工作表最多导入 50,000 行。");
    const handle = await this.connection(scope);
    const suffix = createHash("sha256").update(datasetName).digest("hex").slice(0, 8);
    const table = "dataset_" + identifier(datasetName).toLowerCase() + "_" + suffix;
    const normalizedColumns = columns.map((column, index) => identifier(column) || "column_" + (index + 1));
    const types = normalizedColumns.map((_, index) => sqlType(rows.slice(0, 500).map(row => row[index])));
    const definition = normalizedColumns.map((column, index) => quoteIdentifier(column) + " " + types[index]).join(", ");
    await handle.connection.run("CREATE OR REPLACE TABLE " + quoteIdentifier(table) + " (" + definition + ")");
    const batchSize = Math.max(1, Math.min(100, Math.floor(4_000 / columns.length)));
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const params: Record<string, unknown> = {};
      const values = batch.map((row, rowIndex) => "(" + normalizedColumns.map((_, columnIndex) => {
        const key = "p_" + rowIndex + "_" + columnIndex;
        params[key] = sqlValue(row[columnIndex]);
        return "$" + key;
      }).join(", ") + ")").join(", ");
      await handle.connection.run(
        "INSERT INTO " + quoteIdentifier(table) + " VALUES " + values,
        params,
      );
    }
    return { table, rowCount: rows.length, truncated: false };
  }

  async listTables(scope: string): Promise<Array<{ name: string }>> {
    const handle = await this.connection(scope);
    const result = await handle.connection.runAndReadAll(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    return result.getRowObjectsJson().map(row => ({ name: String(row.name ?? "") }));
  }

  async query(scope: string, sql: string): Promise<AnalyticsQueryResult> {
    const statement = sql.trim().replace(/;+\s*$/, "");
    if (!statement || statement.length > MAX_QUERY_LENGTH) throw new Error("SQL 长度必须在 1–12,000 个字符之间。");
    if (statement.includes(";")) throw new Error("一次只允许执行一条 SQL。");
    if (!/^(select|with)\b/i.test(statement)) throw new Error("DuckDB 工具只允许只读 SELECT / WITH 查询。");
    if (FORBIDDEN_SQL.test(statement)) throw new Error("SQL 包含不允许的写操作、系统操作或外部数据访问函数。");
    const handle = await this.connection(scope);
    const result = await handle.connection.runAndReadAll(
      "SELECT * FROM (" + statement + ") AS agent_query_result LIMIT " + (MAX_QUERY_ROWS + 1),
    );
    const rows = result.getRowObjectsJson();
    return {
      columns: result.columnNames(),
      types: result.columnTypes(),
      rows: rows.slice(0, MAX_QUERY_ROWS),
      rowCount: Math.min(rows.length, MAX_QUERY_ROWS),
      truncated: rows.length > MAX_QUERY_ROWS,
    };
  }

  async close(): Promise<void> {
    const entries = [...this.handles.values()];
    this.handles.clear();
    for (const entry of entries) {
      try {
        const handle = await entry;
        handle.connection.closeSync?.();
        handle.instance.closeSync?.();
      } catch { /* ignore shutdown races */ }
    }
  }
}
