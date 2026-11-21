import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface DocumentTable {
  name: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

export interface ParsedDocument {
  path: string;
  name: string;
  format: string;
  text: string;
  pageCount?: number;
  tables: DocumentTable[];
  warnings: string[];
}

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;
const MAX_SHEETS = 30;
const MAX_COLUMNS = 100;
const MAX_ROWS = 50_000;

function plainCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if ("result" in item) return plainCell(item.result);
    if (Array.isArray(item.richText)) return item.richText.map(part => String((part as { text?: unknown }).text ?? "")).join("");
    if (typeof item.text === "string") return item.text;
    if (typeof item.hyperlink === "string") return item.hyperlink;
  }
  return JSON.stringify(value);
}

function uniqueHeaders(values: unknown[], width: number): string[] {
  const used = new Map<string, number>();
  return Array.from({ length: width }, (_, index) => {
    const raw = String(plainCell(values[index]) ?? "").trim();
    const base = raw.replace(/[\u0000-\u001f]/g, " ").slice(0, 120) || "Column " + (index + 1);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : base + "_" + count;
  });
}

function csvRows(input: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(entry => entry.some(value => value.length > 0));
}

function tableFromMatrix(name: string, matrix: unknown[][]): DocumentTable | null {
  if (!matrix.length) return null;
  const width = Math.min(MAX_COLUMNS, Math.max(...matrix.slice(0, 100).map(row => row.length)));
  if (!width) return null;
  const columns = uniqueHeaders(matrix[0] ?? [], width);
  const allRows = matrix.slice(1).map(row => Array.from({ length: width }, (_, index) => plainCell(row[index])));
  return { name, columns, rows: allRows.slice(0, MAX_ROWS), rowCount: allRows.length, truncated: allRows.length > MAX_ROWS };
}

async function parsePdf(filePath: string, buffer: Buffer): Promise<ParsedDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map(item => "str" in item ? item.str : "").filter(Boolean).join(" ");
    chunks.push("[Page " + pageNumber + "]\n" + text);
    if (chunks.join("\n").length >= MAX_TEXT_CHARS) break;
  }
  const text = chunks.join("\n\n").slice(0, MAX_TEXT_CHARS);
  return {
    path: filePath, name: path.basename(filePath), format: "PDF", text,
    pageCount: document.numPages, tables: [],
    warnings: !text.trim() ? ["未提取到可搜索文本：该 PDF 可能是扫描件或仅含图片，当前版本不执行 OCR。"] : text.length >= MAX_TEXT_CHARS ? ["PDF 文本达到提取上限，后续页面未全部写入上下文。"] : [],
  };
}

async function parseWord(filePath: string, buffer: Buffer, extension: string): Promise<ParsedDocument> {
  if (extension === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return {
      path: filePath, name: path.basename(filePath), format: "DOCX",
      text: result.value.slice(0, MAX_TEXT_CHARS), tables: [],
      warnings: result.messages.map(message => message.message).slice(0, 20),
    };
  }
  const loaded = await import("word-extractor");
  const WordExtractor = loaded.default;
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  const text = document.getBody();
  return {
    path: filePath, name: path.basename(filePath), format: "DOC",
    text: text.slice(0, MAX_TEXT_CHARS), tables: [],
    warnings: text.length > MAX_TEXT_CHARS ? ["DOC 文本达到提取上限。"] : [],
  };
}

async function parseWorkbook(filePath: string, buffer: Buffer): Promise<ParsedDocument> {
  const xlsx = (await import("node-xlsx")).default;
  const worksheets = xlsx.parse(buffer) as Array<{ name: string; data: unknown[][] }>;
  const tables: DocumentTable[] = [];
  const warnings: string[] = [];
  for (const sheet of worksheets.slice(0, MAX_SHEETS)) {
    const table = tableFromMatrix(sheet.name, sheet.data);
    if (table) tables.push(table);
    if (table?.truncated) warnings.push("工作表 " + sheet.name + " 超过 " + MAX_ROWS + " 行，仅导入前 " + MAX_ROWS + " 行。");
  }
  if (worksheets.length > MAX_SHEETS) warnings.push("工作表数量超过限制，仅处理前 " + MAX_SHEETS + " 个。");
  const summary = tables.map(table => "工作表：" + table.name + "；数据行：" + table.rowCount + "；字段：" + table.columns.join(", ") + "\n预览：\n" + JSON.stringify(table.rows.slice(0, 8), null, 2)).join("\n\n");
  return { path: filePath, name: path.basename(filePath), format: path.extname(filePath).slice(1).toUpperCase(), text: summary.slice(0, MAX_TEXT_CHARS), tables, warnings };
}
async function parseDelimitedOrJson(filePath: string, buffer: Buffer, extension: string): Promise<ParsedDocument> {
  const source = buffer.toString("utf8");
  if (extension === ".csv" || extension === ".tsv") {
    const matrix = csvRows(source.replace(/^\uFEFF/, ""), extension === ".tsv" ? "\t" : ",");
    const table = tableFromMatrix(path.basename(filePath, extension), matrix);
    const tables = table ? [table] : [];
    return {
      path: filePath, name: path.basename(filePath), format: extension.slice(1).toUpperCase(),
      text: tables.length ? "字段：" + tables[0]!.columns.join(", ") + "\n数据行：" + tables[0]!.rowCount + "\n预览：\n" + JSON.stringify(tables[0]!.rows.slice(0, 8), null, 2) : source.slice(0, MAX_TEXT_CHARS),
      tables, warnings: table?.truncated ? ["文件超过行数上限，仅导入前 " + MAX_ROWS + " 行。"] : [],
    };
  }
  const parsed: unknown = JSON.parse(source);
  const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  if (records.length && records.every(item => item && typeof item === "object" && !Array.isArray(item))) {
    const columns = [...new Set(records.flatMap(item => Object.keys(item as Record<string, unknown>)))].slice(0, MAX_COLUMNS);
    const rows = records.map(item => columns.map(column => plainCell((item as Record<string, unknown>)[column])));
    const table: DocumentTable = { name: path.basename(filePath, extension), columns, rows: rows.slice(0, MAX_ROWS), rowCount: rows.length, truncated: rows.length > MAX_ROWS };
    return {
      path: filePath, name: path.basename(filePath), format: "JSON",
      text: "字段：" + columns.join(", ") + "\n数据行：" + rows.length + "\n预览：\n" + JSON.stringify(table.rows.slice(0, 8), null, 2),
      tables: [table], warnings: table.truncated ? ["JSON 记录超过行数上限，仅导入前 " + MAX_ROWS + " 行。"] : [],
    };
  }
  return { path: filePath, name: path.basename(filePath), format: "JSON", text: JSON.stringify(parsed, null, 2).slice(0, MAX_TEXT_CHARS), tables: [], warnings: [] };
}

export async function parseDocumentFile(filePath: string): Promise<ParsedDocument> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("附件必须是普通文件。");
  if (info.size > MAX_DOCUMENT_BYTES) throw new Error("附件超过 50 MB 限制。");
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);
  if (extension === ".pdf") return parsePdf(filePath, buffer);
  if (extension === ".doc" || extension === ".docx") return parseWord(filePath, buffer, extension);
  if (extension === ".xls" || extension === ".xlsx" || extension === ".xlsm") return parseWorkbook(filePath, buffer);
  if (extension === ".csv" || extension === ".tsv" || extension === ".json") return parseDelimitedOrJson(filePath, buffer, extension);
  if (extension === ".txt" || extension === ".md" || extension === ".log") {
    return { path: filePath, name: path.basename(filePath), format: extension.slice(1).toUpperCase(), text: buffer.toString("utf8").slice(0, MAX_TEXT_CHARS), tables: [], warnings: [] };
  }
  throw new Error("暂不支持该文件格式。支持 PDF、DOC、DOCX、XLS、XLSX、XLSM、CSV、TSV、JSON、TXT 和 Markdown。");
}
