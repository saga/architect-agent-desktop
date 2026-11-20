import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

type JsonRpcResponse = { jsonrpc: "2.0"; id: number; result?: any; error?: { message?: string } };
type Pending = { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
type SandboxConfig = { command: string; helper: string; env: Record<string, string>; workspace: string };

const MIN_NODE_MAC = [24, 0, 0];
const MIN_NODE_WINDOWS = [24, 21, 0];
const MIN_NODE_WINDOWS_NEXT = [26, 8, 0];
function versionAtLeast(value: string, minimum: number[]): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}
function nodeCandidates(): string[] {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const home = os.homedir();
  const candidates = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, executable));
  if (process.platform === "darwin") {
    candidates.unshift("/opt/homebrew/bin/node", "/usr/local/bin/node", "/opt/local/bin/node");
    candidates.push(path.join(home, ".volta/bin/node"), path.join(home, ".asdf/shims/node"), path.join(home, ".fnm/aliases/default/bin/node"), path.join(home, ".local/share/mise/shims/node"));
    try { for (const version of readdirSync(path.join(home, ".nvm/versions/node")).sort().reverse()) candidates.push(path.join(home, ".nvm/versions/node", version, "bin", "node")); } catch { /* optional nvm installation */ }
    try { for (const version of readdirSync(path.join(home, ".local/share/fnm/node-versions")).sort().reverse()) candidates.push(path.join(home, ".local/share/fnm/node-versions", version, "installation", "bin", "node")); } catch { /* optional fnm installation */ }
  } else if (process.platform === "win32" && process.env.ProgramFiles) candidates.unshift(path.join(process.env.ProgramFiles, "nodejs", executable));
  return [...new Set(candidates)];
}
function resolveNode24(): string {
  for (const candidate of nodeCandidates()) {
    try {
      if (!statSync(candidate).isFile()) continue;
      const version = execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 3000, windowsHide: true }).trim();
      if (process.platform === "win32" ? (versionAtLeast(version, MIN_NODE_WINDOWS) || versionAtLeast(version, MIN_NODE_WINDOWS_NEXT)) : versionAtLeast(version, MIN_NODE_MAC)) return candidate;
    } catch { /* try next candidate */ }
  }
  throw new Error(process.platform === "win32" ? "Rust/WASI Sandbox requires external Node.js 24.21.0+ or 26.8.0+ on Windows for MXC. No compatible runtime was found; host execution fallback is disabled." : "Rust/WASI Sandbox requires external Node.js 24+ on macOS for MXC. No compatible runtime was found; host execution fallback is disabled.");
}
function resourceRoot(): string {
  const candidates = [
    process.env.ARCHITECT_AGENT_RUST_SANDBOX_DIR,
    app.isPackaged ? path.join(process.resourcesPath, "rust-sandbox") : path.resolve(__dirname, "../../../resources/rust-sandbox"),
  ].filter((item): item is string => Boolean(item));
  for (const root of candidates) {
    const manifestPath = path.join(root, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { enabled?: boolean; platform?: string; arch?: string; files?: Record<string, string> };
    if (manifest.enabled !== true || manifest.platform !== process.platform || manifest.arch !== process.arch) continue;
    const executable = process.platform === "win32" ? ".exe" : "";
    const required = ["rust-toolchain/bin/rustc" + executable, "rust-toolchain/bin/cargo" + executable, "wasmtime/wasmtime" + executable, "sdk/Cargo.toml", "template/Cargo.toml", "template/Cargo.lock", "template/src/main.rs"];
    let valid = true;
    for (const relative of required) {
      const absolute = path.join(root, ...relative.split("/"));
      const expected = manifest.files?.[relative];
      if (!expected || !existsSync(absolute) || createHash("sha256").update(readFileSync(absolute)).digest("hex") !== expected) { valid = false; break; }
    }
    if (valid) return root;
  }
  throw new Error("Rust/WASI resources are unavailable or do not match this platform. Build the platform-specific Rust sandbox resources before packaging.");
}
function configFor(workspaceValue: string): SandboxConfig {
  if (process.platform !== "darwin" && process.platform !== "win32") throw new Error("MXC sandbox currently supports macOS and Windows only. This platform fails closed.");
  const workspace = realpathSync(workspaceValue);
  const root = resourceRoot();
  const helper = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "main", "sandbox", "mxc-mcp-server.mjs")
    : path.resolve(__dirname, "../sandbox/mxc-mcp-server.mjs");
  if (!existsSync(helper)) throw new Error("MXC Sandbox helper is missing from the application build.");
  const executable = process.platform === "win32" ? ".exe" : "";
  const toolchain = path.join(root, "rust-toolchain");
  const sdk = path.join(root, "sdk");
  const template = path.join(root, "template");
  const wasmtime = path.join(root, "wasmtime", "wasmtime" + executable);
  const node = resolveNode24();
  const env: Record<string, string> = {
    PATH: [path.dirname(node), path.join(toolchain, "bin"), path.dirname(wasmtime), process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
    WORKSPACE_DIR: workspace,
    HOST_PLATFORM: process.platform,
    RUST_TOOLCHAIN_DIR: toolchain,
    RUST_SDK_DIR: sdk,
    RUST_TEMPLATE_DIR: template,
    WASMTIME_BIN: wasmtime,
    NODE_NO_WARNINGS: "1",
  };
  if (process.platform === "win32") {
    env.SystemRoot = process.env.SystemRoot ?? "";
    env.ComSpec = process.env.ComSpec ?? "cmd.exe";
    env.ProgramFiles = process.env.ProgramFiles ?? "";
    env["ProgramFiles(x86)"] = process.env["ProgramFiles(x86)"] ?? "";
  }
  return { command: node, helper, env, workspace };
}

export class RustSandboxClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private workspace: string | null = null;
  private starting: Promise<void> | null = null;

  isAvailable(): boolean {
    try { resourceRoot(); return process.platform === "darwin" || process.platform === "win32"; }
    catch { return false; }
  }

  async call(name: "execute_rust" | "apply_rust_changes", args: unknown, workspacePath: string): Promise<string> {
    await this.ensureStarted(workspacePath);
    const response = await this.request("tools/call", { name, arguments: args });
    if (response?.isError) throw new Error(response.content?.map((part: any) => part.text ?? "").join("\n") || (name + " failed."));
    return response?.content?.map((part: any) => typeof part.text === "string" ? part.text : "").join("\n") || JSON.stringify(response);
  }

  private async ensureStarted(workspacePath: string): Promise<void> {
    const canonical = realpathSync(workspacePath);
    if (this.child && this.workspace === canonical) return;
    if (this.child) await this.dispose();
    if (!this.starting) {
      this.starting = (async () => {
        const config = configFor(canonical);
        const child = spawn(config.command, [config.helper], { cwd: config.workspace, env: config.env, stdio: "pipe", windowsHide: true });
        this.child = child;
        this.workspace = canonical;
        const lines = createInterface({ input: child.stdout });
        lines.on("line", line => {
          let message: JsonRpcResponse;
          try { message = JSON.parse(line) as JsonRpcResponse; } catch { return; }
          if (typeof message.id !== "number") return;
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(message.error.message ?? "MXC MCP request failed."));
          else pending.resolve(message.result);
        });
        child.stderr.on("data", chunk => {
          const detail = String(chunk).trim();
          if (detail) console.warn("[rust-sandbox]", detail.slice(0, 4000));
        });
        child.once("error", error => this.failAll(error));
        child.once("exit", code => this.failAll(new Error("MXC sandbox process exited (code " + code + ").")));
        await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "architect-agent-desktop", version: app.getVersion() } });
        this.notify("notifications/initialized", {});
      })().finally(() => { this.starting = null; });
    }
    await this.starting;
  }

  private request(method: string, params: unknown): Promise<any> {
    const child = this.child;
    if (!child || child.killed) return Promise.reject(new Error("MXC sandbox process is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("MXC sandbox request timed out: " + method)); }, 11 * 60 * 1000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", error => {
        if (error) { const item = this.pending.get(id); if (item) { this.pending.delete(id); clearTimeout(item.timer); reject(error); } }
      });
    });
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private failAll(error: Error): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.child = null;
    this.workspace = null;
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.workspace = null;
    if (child) {
      try { child.stdin.end(); child.kill(); } catch { /* already exited */ }
    }
    this.failAll(new Error("MXC sandbox process was stopped."));
  }
}
