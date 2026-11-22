import path from "node:path";
import type { AgentProvider, AgentToolPermission } from "../../shared/types";
import type { PluginRuntimeEntry } from "./plugin-content";
export type { PluginRuntimeEntry } from "./plugin-content";

/**
 * Runtime plugins are supported by both provider SDKs, but are never an
 * implicit permission grant. An Expert may narrow both tools and Skills.
 */
export function filterPluginRuntimeEntries(
  provider: AgentProvider,
  effectivePermission: AgentToolPermission,
  expertAllowsAllTools: boolean,
  selectedSkills: readonly string[] | undefined,
  entries: readonly PluginRuntimeEntry[],
): PluginRuntimeEntry[] {
  if ((provider !== "copilot" && provider !== "codebuddy")
    || effectivePermission !== "allow-all"
    || !expertAllowsAllTools) return [];

  const selected = selectedSkills === undefined ? null : new Set(selectedSkills);
  return entries
    .filter(entry => typeof entry.directory === "string" && path.isAbsolute(entry.directory))
    .filter(entry => selected === null || entry.skills.every(skill => selected.has(entry.id + ":" + skill)))
    .slice(0, 50)
    .map(entry => ({ ...entry, skills: [...entry.skills] }));
}

/** Kept as a small path-only helper for consumers that do not use Expert Skills. */
export function filterPluginRuntimeDirectories(
  provider: AgentProvider,
  effectivePermission: AgentToolPermission,
  expertAllowsAllTools: boolean,
  directories: readonly string[],
): string[] {
  return filterPluginRuntimeEntries(provider, effectivePermission, expertAllowsAllTools, undefined,
    directories.map(directory => ({ id: path.basename(directory), directory, skills: [], fingerprint: "" })))
    .map(entry => entry.directory);
}

/**
 * Minimum SDK built-ins required for plugin Skills and custom-Agent dispatch,
 * plus the Bash tool needed by plugin-referenced local scripts. This list is
 * used only after the caller has enabled the same sandboxed runtime path.
 */
export function pluginRuntimeBuiltinTools(runtimeAllowed: boolean): string[] {
  return runtimeAllowed ? ["bash", "skill", "task"] : [];
}

/** Prevent ambient per-user Copilot plugins from bypassing the app's approval registry. */
export function copilotPluginEnvironment(environment: Record<string, string | undefined>): Record<string, string | undefined> {
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (key.toUpperCase() === "COPILOT_PLUGIN_DIR_ONLY") delete result[key];
  }
  result.COPILOT_PLUGIN_DIR_ONLY = "true";
  return result;
}

/** Copilot SDK launches its CLI with one explicit --plugin-dir pair per staged plugin. */
export function copilotPluginDirectoryArgs(directories: readonly string[]): string[] {
  return directories.flatMap(directory => ["--plugin-dir", directory]);
}

/**
 * CodeBuddy accepts CODEBUDDY_PLUGIN_DIRS as a platform-delimited path list.
 * Strip inherited values first so only this request's approved, staged snapshots
 * are exposed to the native plugin loader.
 */
export function codeBuddyPluginEnvironment(
  environment: Record<string, string | undefined>,
  directories: readonly string[],
): Record<string, string | undefined> {
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (key.toUpperCase() === "CODEBUDDY_PLUGIN_DIRS") delete result[key];
  }
  if (directories.length) result.CODEBUDDY_PLUGIN_DIRS = directories.join(path.delimiter);
  return result;
}
