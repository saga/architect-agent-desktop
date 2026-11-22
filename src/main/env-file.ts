import { readFileSync } from "node:fs";

export function parseEnvironmentFile(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      try { value = JSON.parse(value) as string; } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

export function loadEnvironmentFile(file: string, target: NodeJS.ProcessEnv = process.env): void {
  let source: string;
  try { source = readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const [key, value] of Object.entries(parseEnvironmentFile(source))) {
    if (target[key] === undefined) target[key] = value;
  }
}
