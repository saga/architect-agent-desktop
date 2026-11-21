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

  it("rejects SQL outside the read-only SELECT/WITH envelope", async () => {
    const analytics = new DuckDbAnalyticsService(temporaryDirectory());
    await expect(analytics.query("/workspace/a", "ATTACH 'private.db' AS private_db")).rejects.toThrow(/只允许只读/);
    await expect(analytics.query("/workspace/a", "")).rejects.toThrow(/SQL 长度/);
  });
});
