/**
 * Login-shell environment for macOS/Linux launches that inherit only the
 * session manager's environment.
 *
 * An app started from Finder or Dock gets launchd's minimal PATH, so agent CLI
 * runtimes spawned from it cannot find Homebrew, nvm or `~/.local/bin` tools.
 * Running the user's login shell once and reusing its environment fixes that
 * without asking the user to configure anything.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";

const DELIMITER = "_ARCHITECT_SHELL_ENV_DELIMITER_";
/** Real NUL bytes so the parser can tell "command failed" from "empty environment". */
const MARKER = `\0${DELIMITER}\0`;
const DUMP = `printf '\\0%s\\0' '${DELIMITER}'; command env -0 || exit; printf '\\0%s\\0' '${DELIMITER}'; exit`;
const FALLBACK_SHELLS = ["/bin/zsh", "/bin/bash", "/bin/sh"] as const;

/** Keep interactive shells from blocking on update prompts or tmux autostart. */
const PROBE_ENVIRONMENT = {
  DISABLE_AUTO_UPDATE: "true",
  ZSH_TMUX_AUTOSTARTED: "true",
  ZSH_TMUX_AUTOSTART: "false",
} as const;

/** Variables that describe the probe shell process rather than the user's configuration. */
const SHELL_SESSION_KEYS = new Set(["PWD", "OLDPWD", "SHLVL", "_", ...Object.keys(PROBE_ENVIRONMENT)]);

/** Variables owned by the Electron launcher; the app already has the right values. */
const LAUNCHER_OWNED_PREFIXES = ["ELECTRON_"] as const;

const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface LoginShellEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shell?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Extract the environment block between the two markers emitted by the probe.
 * Returns an empty object when the markers are missing or out of order.
 */
export function parseEnvironmentDump(output: string): Record<string, string> {
  const start = output.indexOf(MARKER);
  if (start < 0) return {};
  const end = output.indexOf(MARKER, start + MARKER.length);
  if (end < 0) return {};

  const environment: Record<string, string> = {};
  for (const entry of output.slice(start + MARKER.length, end).split("\0")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (SHELL_SESSION_KEYS.has(key)) continue;
    if (LAUNCHER_OWNED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    environment[key] = entry.slice(separator + 1);
  }
  return environment;
}

function candidateShells(env: NodeJS.ProcessEnv, configured?: string): string[] {
  const shells: string[] = [];
  const preferred = (configured ?? env.SHELL ?? "").trim();
  if (preferred && isAbsolute(preferred)) shells.push(preferred);
  for (const shell of FALLBACK_SHELLS) {
    if (!shells.includes(shell)) shells.push(shell);
  }
  return shells;
}

function killProcessGroup(child: ChildProcess): void {
  if (child.pid) {
    try {
      // The probe runs detached, so the whole group dies with the shell.
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch { /* fall through to a single-process kill */ }
  }
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
}

function probeShell(
  shell: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(shell, ["-ilc", DUMP], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...env, ...PROBE_ENVIRONMENT },
      });
    } catch {
      resolve(null);
      return;
    }

    let output = "";
    let settled = false;
    const finish = (value: Record<string, string> | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const abort = (): void => {
      killProcessGroup(child);
      finish(null);
    };
    const timer = setTimeout(abort, timeoutMs);
    const onAbort = (): void => abort();

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (output.length < MAX_OUTPUT_BYTES) output += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", () => finish(parseEnvironmentDump(output)));
  });
}

/**
 * Read the environment produced by the user's login shell.
 * Returns null when the platform has no POSIX shell or every probe fails.
 */
export async function readLoginShellEnvironment(
  options: LoginShellEnvironmentOptions = {}
): Promise<Record<string, string> | null> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return null;

  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 5000;

  for (const shell of candidateShells(env, options.shell)) {
    if (options.signal?.aborted) return null;
    const environment = await probeShell(shell, env, timeoutMs, options.signal);
    if (environment && Object.keys(environment).length > 0) return environment;
  }
  return null;
}

let cached: Promise<Record<string, string> | null> | null = null;
let controller: AbortController | null = null;

/** Start the probe once and reuse the result for the rest of the process lifetime. */
export function primeLoginShellEnvironment(): Promise<Record<string, string> | null> {
  if (!cached) {
    controller = new AbortController();
    cached = readLoginShellEnvironment({ signal: controller.signal }).catch(() => null);
  }
  return cached;
}

/** Abort an in-flight probe; called on quit so a slow shell cannot delay exit. */
export function disposeLoginShellEnvironment(): void {
  controller?.abort();
  controller = null;
}

/**
 * Environment for agent CLI subprocesses: the inherited environment plus the
 * login shell's PATH and tool variables. The shell wins because it describes
 * the user's actual setup.
 */
export async function agentProcessEnvironment(): Promise<Record<string, string | undefined>> {
  const captured = await primeLoginShellEnvironment();
  return captured ? { ...process.env, ...captured } : { ...process.env };
}
