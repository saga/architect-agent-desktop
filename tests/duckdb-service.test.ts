import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DuckDbAnalyticsService } from "../src/main/analytics/duckdb-service";

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "architect-agent-duckdb-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("DuckDbAnalyticsService SQL boundary", () => {
  it("rejects writes, external file readers, and multi-statement SQL before opening a database", async () => {
    const analytics = new DuckDbAnalyticsService(temporaryDirectory());
    await expect(analytics.query("/workspace/a", "DROP TABLE holdings")).rejects.toThrow(/只允许只读/);
    await expect(analytics.query("/workspace/a", "SELECT * FROM read_csv_auto('/tmp/private.csv')")).rejects.toThrow(/外部数据访问/);
    await expect(analytics.query("/workspace/a", "SELECT 1; SELECT 2")).rejects.toThrow(/一条 SQL/);
  });

  it("imports datasets atomically and keeps tables isolated by Workspace", async () => {
    const analytics = new DuckDbAnalyticsService(temporaryDirectory());
    try {
      const imported = await analytics.importRows("/workspace/portfolio-a", "Holdings", ["Ticker", "Market Value"], [
        ["AAPL", 125],
        ["MSFT", 90],
      ]);
      expect(imported.rowCount).toBe(2);
      const result = await analytics.query("/workspace/portfolio-a", `SELECT * FROM "${imported.table}" ORDER BY "Ticker"`);
      expect(result.columns).toEqual(["Ticker", "Market_Value"]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({ Ticker: "AAPL", Market_Value: 125 });
      expect((await analytics.listTables("/workspace/portfolio-b"))).toHaveLength(0);

      const failingRows: unknown[][] = Array.from({ length: 500 }, (_, index) => [index + 1]);
      failingRows.push(["not-a-number"]);
      await expect(analytics.importRows("/workspace/portfolio-a", "Holdings", ["Market Value"], failingRows))
        .rejects.toThrow();
      const afterFailure = await analytics.query("/workspace/portfolio-a", `SELECT * FROM "${imported.table}"`);
      expect(afterFailure.rows).toHaveLength(2);
      expect(afterFailure.rows[0]).toMatchObject({ Ticker: "AAPL", Market_Value: 125 });
    } finally {
      await analytics.close();
    }
  });

  it("caps query results and reports truncation", async () => {
    const analytics = new DuckDbAnalyticsService(temporaryDirectory());
    try {
      const result = await analytics.query("/workspace/limits", "SELECT range AS id FROM range(501)");
      expect(result.rows).toHaveLength(500);
      expect(result.rowCount).toBe(500);
      expect(result.truncated).toBe(true);
    } finally {
      await analytics.close();
    }
  });

  it("rejects SQL outside the read-only SELECT/WITH envelope", async () => {
    const analytics = new DuckDbAnalyticsService(temporaryDirectory());
    await expect(analytics.query("/workspace/a", "ATTACH 'private.db' AS private_db")).rejects.toThrow(/只允许只读/);
    await expect(analytics.query("/workspace/a", "")).rejects.toThrow(/SQL 长度/);
  });
});
