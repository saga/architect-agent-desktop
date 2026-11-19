/**
 * Crash reports and a bounded recent-operation journal.
 *
 * The app previously had no main-process error handling: an uncaught exception
 * exited silently and left nothing to inspect. Diagnostics must never throw and
 * must never block normal startup, so every write is wrapped.
 */
import { app, dialog, shell } from "electron";
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_CRASH_LOGS = 10;
const MAX_JOURNAL_BYTES = 256 * 1024;
const MAX_DETAIL_CHARS = 1200;

let logDirectory: string | null = null;
let journalBytes = -1;
let fatalDialogOpen = false;

function directory(): string {
  if (!logDirectory) {
    logDirectory = path.join(app.getPath("userData"), "logs");
    mkdirSync(logDirectory, { recursive: true });
  }
  return logDirectory;
}

function fileSize(filePath: string): number {
  try { return statSync(filePath).size; } catch { return 0; }
}

/** Append one line to the recent-operation journal, rotating at 256 KiB. */
export function recordOperation(kind: string, message: string): void {
  try {
    const file = path.join(directory(), "operations.log");
    if (journalBytes < 0) journalBytes = fileSize(file);

    const line = JSON.stringify({
      at: new Date().toISOString(),
      kind,
      message: message.slice(0, 1000),
    }) + "\n";
    const bytes = Buffer.byteLength(line);

    if (journalBytes + bytes > MAX_JOURNAL_BYTES) {
      const previous = path.join(directory(), "operations.previous.log");
      try { rmSync(previous, { force: true }); } catch { /* ignore */ }
      try { renameSync(file, previous); } catch { /* ignore */ }
      journalBytes = 0;
    }

    appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
    journalBytes += bytes;
  } catch {
    // Diagnostics are best effort and must never affect the app.
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? "(no stack)"}`;
  }
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function pruneCrashLogs(): void {
  try {
    const files = readdirSync(directory())
      .filter((name) => name.startsWith("crash-") && name.endsWith(".log"))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - MAX_CRASH_LOGS))) {
      try { rmSync(path.join(directory(), name), { force: true }); } catch { /* ignore */ }
    }
  } catch {
    // ignore
  }
}

/** Persist a crash report and return its path, or null when writing failed. */
export function recordCrash(kind: string, error: unknown): string | null {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(directory(), `crash-${stamp}.log`);
    const header = [
      `[${new Date().toISOString()}] ${kind}`,
      `app=${app.getVersion()} electron=${process.versions.electron} node=${process.versions.node}`,
      `platform=${process.platform}/${process.arch}`,
      "",
    ].join("\n");
    writeFileSync(file, header + formatError(error) + "\n", { encoding: "utf8", mode: 0o600 });
    pruneCrashLogs();
    return file;
  } catch {
    return null;
  }
}

function summarize(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_DETAIL_CHARS ? collapsed.slice(0, MAX_DETAIL_CHARS) + "…" : collapsed;
}

async function showFatalDialog(kind: string, text: string, logPath: string | null): Promise<"restart" | "quit" | "logs"> {
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "Architect Agent Desktop 遇到问题",
    message: summarize(text),
    detail: [
      `错误类型：${kind}`,
      logPath ? `诊断日志：${logPath}` : "诊断日志写入失败。",
      "",
      "退出后重新启动通常可以恢复。",
    ].join("\n"),
    buttons: ["退出", "重新启动", "打开日志文件夹"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response === 1) return "restart";
  if (response === 2) return "logs";
  return "quit";
}

async function handleFatal(kind: string, error: unknown): Promise<void> {
  const text = formatError(error);
  const logPath = recordCrash(kind, error);
  console.error(`[${kind}] ${text}`);

  if (!app.isReady() || fatalDialogOpen) {
    app.exit(1);
    return;
  }

  fatalDialogOpen = true;
  let choice: "restart" | "quit" | "logs" = "quit";
  try { choice = await showFatalDialog(kind, text, logPath); }
  catch { /* fall through to exit */ }
  fatalDialogOpen = false;

  if (choice === "restart") {
    app.relaunch();
    app.exit(0);
    return;
  }
  if (choice === "logs" && logPath) {
    await shell.openPath(path.dirname(logPath)).catch(() => undefined);
  }
  app.exit(1);
}

/** Catch main-process failures and route them to a native recovery dialog. */
export function installCrashHandlers(): void {
  process.on("uncaughtException", (error) => { void handleFatal("uncaughtException", error); });
  process.on("unhandledRejection", (reason) => { void handleFatal("unhandledRejection", reason); });
}
