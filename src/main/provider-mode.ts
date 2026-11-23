import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";

let agentDevMode = false;

export function loadAgentDevMode(
  appPath: string,
  isPackaged: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isPackaged) {
    agentDevMode = false;
    return false;
  }

  try {
    const parsed = parseEnv(readFileSync(path.join(appPath, ".env"), "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (environment[key] === undefined) environment[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  agentDevMode = environment.ARCHITECT_AGENT_DEV_MODE?.trim().toLowerCase() === "true";
  return agentDevMode;
}

export function isAgentDevMode(): boolean {
  return agentDevMode;
}
