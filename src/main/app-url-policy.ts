import path from "node:path";
import { fileURLToPath } from "node:url";

export function isTrustedAppUrl(value: string, rendererHtmlPath: string, developmentUrl?: string): boolean {
  try {
    const target = new URL(value);
    if (developmentUrl) {
      const expected = new URL(developmentUrl);
      return target.protocol === expected.protocol && target.origin === expected.origin;
    }
    if (target.protocol !== "file:") return false;
    return path.resolve(fileURLToPath(target)) === path.resolve(rendererHtmlPath);
  } catch {
    return false;
  }
}
