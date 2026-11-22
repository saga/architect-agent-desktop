import { existsSync } from "node:fs";
import path from "node:path";

export interface ChromeLaunchTarget {
  command: string;
  argsPrefix: string[];
}

type Exists = (candidate: string) => boolean;

export function findChromeExecutable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync,
): ChromeLaunchTarget | null {
  // Use the target platform's path semantics even when discovery is tested
  // or invoked from a different host platform (e.g. Windows CI checking macOS).
  const join = platform === "win32" ? path.win32.join : path.posix.join;

  if (platform === "darwin") {
    const appPaths = [
      "/Applications/Google Chrome.app",
      ...(env.HOME ? [join(env.HOME, "Applications", "Google Chrome.app")] : []),
    ];
    const appPath = appPaths.find(candidate => exists(join(candidate, "Contents", "MacOS", "Google Chrome")));
    return appPath ? { command: "/usr/bin/open", argsPrefix: ["-a", appPath] } : null;
  }

  if (platform === "win32") {
    const candidates = [
      env.PROGRAMFILES ? join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
      env["PROGRAMFILES(X86)"] ? join(env["PROGRAMFILES(X86)"]!, "Google", "Chrome", "Application", "chrome.exe") : "",
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
    ].filter(Boolean);
    const executable = candidates.find(exists);
    return executable ? { command: executable, argsPrefix: [] } : null;
  }

  if (platform === "linux") {
    const candidates = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/local/bin/google-chrome",
      "/opt/google/chrome/chrome",
    ];
    const executable = candidates.find(exists);
    return executable ? { command: executable, argsPrefix: [] } : null;
  }

  return null;
}
