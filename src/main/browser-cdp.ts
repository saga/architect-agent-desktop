import type { WebContents } from "electron";

/** Chrome DevTools Protocol revision attached to a browser tab. */
export const BROWSER_CDP_PROTOCOL = "1.3";
export const BROWSER_CDP_TIMEOUT_MS = 30_000;

/**
 * Read-only CDP diagnostics exposed to the Agent. Page execution, synthetic
 * input, navigation, cookies, storage, targets and network interception stay
 * outside this allowlist; normal browser interaction uses dedicated tools.
 */
export const BROWSER_CDP_ALLOWLIST = new Set([
  "Page.enable",
  "Page.captureScreenshot",
  "Page.getLayoutMetrics",
  "DOM.enable",
  "DOM.getDocument",
  "DOM.querySelector",
  "DOM.querySelectorAll",
  "DOM.getBoxModel",
  "DOM.describeNode",
  "DOM.getOuterHTML",
  "DOM.getAttributes",
  "Runtime.enable",
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "Console.enable",
]);

const MAX_EVALUATE_CHARS = 64 * 1024;
const MAX_CONSOLE_MESSAGES = 100;
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_MAX_HEIGHT = 2048;

export type BrowserConsoleMessage = {
  type: string;
  text: string;
  timestamp: number;
};

export type AxNode = {
  nodeId?: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
  childIds?: string[];
};

export type SnapshotResult = {
  tree: string;
  url: string;
  title: string;
};

export function isAllowedCdpMethod(method: string): boolean {
  return BROWSER_CDP_ALLOWLIST.has(method.trim());
}

/**
 * Flatten an accessibility tree into indented text with stable `eN` uids.
 * Ignored nodes are skipped; uids map to backend DOM node ids for click/fill.
 */
export function flattenAxTree(nodes: AxNode[]): {
  tree: string;
  uids: Map<string, number>;
} {
  const byId = new Map<string, AxNode>();
  for (const node of nodes) {
    if (typeof node.nodeId === "string") byId.set(node.nodeId, node);
  }
  const childIds = new Set<string>();
  for (const node of nodes) {
    for (const id of node.childIds ?? []) childIds.add(id);
  }
  const roots = nodes.filter(
    (node) => typeof node.nodeId === "string" && !childIds.has(node.nodeId),
  );
  const uids = new Map<string, number>();
  const lines: string[] = [];
  let next = 1;

  const walk = (node: AxNode, depth: number) => {
    if (!node.ignored) {
      const role = node.role?.value?.trim() || "Generic";
      const name = node.name?.value?.trim() ?? "";
      const uid = `e${next}`;
      next += 1;
      if (typeof node.backendDOMNodeId === "number") {
        uids.set(uid, node.backendDOMNodeId);
      }
      const label = name ? `${role} ${JSON.stringify(name)}` : role;
      lines.push(`${"  ".repeat(depth)}- ${uid} ${label}`);
    }
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) walk(child, node.ignored ? depth : depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  return { tree: lines.join("\n") || "(empty)", uids };
}

function consoleText(args: unknown): string {
  if (!Array.isArray(args)) return String(args ?? "");
  return args
    .map((arg) => {
      if (!arg || typeof arg !== "object") return String(arg);
      const record = arg as { value?: unknown; description?: string; type?: string };
      if (typeof record.value === "string") return record.value;
      if (record.value !== undefined) return String(record.value);
      if (typeof record.description === "string") return record.description;
      return record.type ?? "";
    })
    .filter(Boolean)
    .join(" ");
}

function throwIfException(result: {
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}): void {
  if (!result.exceptionDetails) return;
  const message =
    result.exceptionDetails.exception?.description ||
    result.exceptionDetails.text ||
    "browser operation failed";
  throw Object.assign(new Error(message), { code: "TOOL_FAILED" });
}

/** CDP session bound to one browser tab. Snapshot uids are valid until the next snapshot. */
export class BrowserCdp {
  private attachedId: number | null = null;
  private uids = new Map<string, number>();
  private messages: BrowserConsoleMessage[] = [];
  private onDebuggerMessage?: (event: unknown, method: string, params: unknown) => void;

  isAttached(wc: WebContents): boolean {
    return this.attachedId === wc.id && !wc.isDestroyed() && wc.debugger.isAttached();
  }

  async attach(wc: WebContents): Promise<void> {
    if (wc.isDestroyed()) throw new Error("browser tab is not available");
    if (this.isAttached(wc)) return;
    this.detach();
    if (!wc.debugger.isAttached()) wc.debugger.attach(BROWSER_CDP_PROTOCOL);
    this.attachedId = wc.id;
    this.onDebuggerMessage = (_event, method, params) => {
      if (method !== "Runtime.consoleAPICalled" && method !== "Console.messageAdded") return;
      const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
      const type =
        typeof record.type === "string"
          ? record.type
          : typeof (record.message as { level?: string } | undefined)?.level === "string"
            ? (record.message as { level: string }).level
            : "log";
      const text =
        method === "Console.messageAdded"
          ? String((record.message as { text?: string } | undefined)?.text ?? "")
          : consoleText(record.args);
      this.messages.push({ type, text, timestamp: Date.now() });
      if (this.messages.length > MAX_CONSOLE_MESSAGES) this.messages.shift();
    };
    wc.debugger.on("message", this.onDebuggerMessage);
    await wc.debugger.sendCommand("Runtime.enable");
    await wc.debugger.sendCommand("Console.enable");
    await wc.debugger.sendCommand("Page.enable");
    await wc.debugger.sendCommand("DOM.enable");
    await wc.debugger.sendCommand("Accessibility.enable");
    try {
      // Chromium ignores input on detached guests unless it emulates focus.
      await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    } catch {
      // Older Chromium builds may not support focus emulation.
    }
  }

  detach(wc?: WebContents): void {
    const target = wc && !wc.isDestroyed() ? wc : null;
    if (target?.debugger.isAttached()) {
      if (this.onDebuggerMessage) target.debugger.off("message", this.onDebuggerMessage);
      try { target.debugger.detach(); } catch { /* already detached */ }
    }
    this.onDebuggerMessage = undefined;
    this.attachedId = null;
    this.uids.clear();
  }

  /** Drop snapshot uids after a navigation; the next snapshot rebuilds them. */
  resetUids(): void {
    this.uids.clear();
  }

  async send(wc: WebContents, method: string, params?: unknown): Promise<unknown> {
    const name = method.trim();
    if (!isAllowedCdpMethod(name)) {
      throw Object.assign(new Error(`CDP method not allowed: ${name}`), {
        code: "PERMISSION_DENIED",
      });
    }
    await this.attach(wc);
    return wc.debugger.sendCommand(
      name,
      (params && typeof params === "object" ? params : {}) as Record<string, unknown>,
    );
  }

  async snapshot(wc: WebContents): Promise<SnapshotResult> {
    await this.attach(wc);
    const raw = (await wc.debugger.sendCommand("Accessibility.getFullAXTree")) as {
      nodes?: AxNode[];
    };
    const flattened = flattenAxTree(Array.isArray(raw?.nodes) ? raw.nodes : []);
    this.uids = flattened.uids;
    return { tree: flattened.tree, url: wc.getURL(), title: wc.getTitle() };
  }

  async screenshot(
    wc: WebContents,
    input: { fullPage?: boolean } = {},
  ): Promise<{ mimeType: "image/jpeg"; data: string }> {
    await this.attach(wc);
    let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
    if (input.fullPage) {
      const metrics = (await wc.debugger.sendCommand("Page.getLayoutMetrics")) as {
        contentSize?: { width?: number; height?: number };
        cssContentSize?: { width?: number; height?: number };
      };
      const size = metrics.cssContentSize ?? metrics.contentSize ?? { width: 0, height: 0 };
      const width = Math.max(1, Number(size.width) || 1);
      const height = Math.max(1, Number(size.height) || 1);
      const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / width, SCREENSHOT_MAX_HEIGHT / height);
      clip = { x: 0, y: 0, width, height, scale };
    }
    const result = (await wc.debugger.sendCommand("Page.captureScreenshot", {
      format: "jpeg",
      quality: 70,
      ...(clip ? { clip, captureBeyondViewport: true } : {}),
    })) as { data?: string };
    if (typeof result?.data !== "string" || !result.data) {
      throw new Error("screenshot produced no data");
    }
    return { mimeType: "image/jpeg", data: result.data };
  }

  async click(wc: WebContents, uid: string): Promise<void> {
    const backendNodeId = this.requireUid(uid);
    await this.attach(wc);
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false });
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    const resolved = (await wc.debugger.sendCommand("DOM.resolveNode", { backendNodeId })) as {
      object?: { objectId?: string };
    };
    const objectId = resolved.object?.objectId;
    if (!objectId) throw Object.assign(new Error(`could not resolve ${uid}`), { code: "NOT_FOUND" });

    const evaluated = (await wc.debugger.sendCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function () {
        const text = (this.innerText || this.getAttribute("aria-label") || "").trim();
        const type = (this.getAttribute("type") || "").toLowerCase();
        if (type === "submit" || this.tagName === "FORM" ||
            (this.closest("form") && this.tagName === "BUTTON" && type !== "button") ||
            /pay|purchase|buy now|add to cart|checkout|place order|delete|remove account|send message|transfer|confirm payment|unsubscribe|publish|post now|支付|付款|购买|下单|加入购物车|立即购买|结算|转账|汇款|删除|移除账户|注销|发送消息|发送邮件|提交|确认支付|发布|立即发布|退订|取消订阅|确认删除|确认订单/i.test(text)) {
          return { blocked: true, reason: "Potentially consequential action blocked. Ask the user to perform it." };
        }
        const view = this.ownerDocument.defaultView;
        let rect = this.getBoundingClientRect();
        if (rect.left < 0 || rect.top < 0 || rect.right > view.innerWidth || rect.bottom > view.innerHeight) {
          this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        }
        return new Promise(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => {
          rect = this.getBoundingClientRect();
          const left = Math.max(0, rect.left), right = Math.min(view.innerWidth, rect.right);
          const top = Math.max(0, rect.top), bottom = Math.min(view.innerHeight, rect.bottom);
          resolve(right > left && bottom > top ? { blocked: false, x: (left + right) / 2, y: (top + bottom) / 2 } : { blocked: false, point: null });
        })));
      }`,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: { blocked?: boolean; reason?: string; x?: number; y?: number } | null }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
    throwIfException(evaluated);
    const value = evaluated.result?.value;
    if (value?.blocked) throw new Error(value.reason || "Potentially consequential action blocked.");
    if (typeof value?.x !== "number" || typeof value.y !== "number" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
      throw Object.assign(new Error(`no visible box for ${uid}`), { code: "NOT_FOUND" });
    }
    const { x, y } = value;
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y, button: "none", buttons: 0,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0,
    });
  }

  async fill(wc: WebContents, uid: string, text: string): Promise<void> {
    const backendNodeId = this.requireUid(uid);
    await this.attach(wc);
    const resolved = (await wc.debugger.sendCommand("DOM.resolveNode", { backendNodeId })) as {
      object?: { objectId?: string };
    };
    const objectId = resolved.object?.objectId;
    if (!objectId) throw Object.assign(new Error(`could not resolve ${uid}`), { code: "NOT_FOUND" });
    const result = (await wc.debugger.sendCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function (value) {
        if (!(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement)) {
          throw new Error("Only input and textarea fields can be filled.");
        }
        if (this instanceof HTMLInputElement && ["password","hidden","submit","button","file"].includes(this.type)) {
          throw new Error("This field type cannot be filled by the agent.");
        }
        const fieldHints = [
          this.name, this.id, this.autocomplete,
          this.getAttribute("aria-label"), this.getAttribute("placeholder"),
        ].filter(Boolean).join(" ").toLowerCase();
        if (/password|passwd|secret|token|one[-_ ]?time|verification|security.?code|cvv|cvc|credit.?card|card.?number|expiry|expiration|ssn|national.?id|bank.?account|routing.?number|验证码|校验码|短信码|动态码|密码|安全码|卡号|信用卡|身份证|银行卡|账户号码|有效期|社保号/i.test(fieldHints)) {
          throw new Error("This field appears to contain sensitive information and cannot be filled by the agent.");
        }
        this.focus({ preventScroll: true });
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), "value")?.set;
        setter?.call(this, value);
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }`,
      arguments: [{ value: text }],
    })) as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
    throwIfException(result);
  }

  async evaluate(wc: WebContents, expression: string): Promise<unknown> {
    await this.attach(wc);
    const result = (await wc.debugger.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: unknown; description?: string; type?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    throwIfException(result);
    const value = result.result?.value ?? result.result?.description ?? null;
    const serialized = JSON.stringify(value);
    if (serialized && serialized.length > MAX_EVALUATE_CHARS) {
      return { truncated: true, value: serialized.slice(0, MAX_EVALUATE_CHARS) };
    }
    return value;
  }

  async console(wc: WebContents, limit = 50): Promise<BrowserConsoleMessage[]> {
    await this.attach(wc);
    const cap = Math.min(MAX_CONSOLE_MESSAGES, Math.max(1, Math.floor(limit) || 50));
    return this.messages.slice(-cap);
  }

  private requireUid(uid: string): number {
    const id = this.uids.get(uid.trim());
    if (typeof id !== "number") {
      throw Object.assign(
        new Error(`unknown or stale uid "${uid}"; call browser_snapshot first`),
        { code: "INVALID_ARGUMENT" },
      );
    }
    return id;
  }
}

/** Bound a CDP round trip. On timeout detach the debugger so the next call can re-attach. */
export function withCdpDeadline<T>(
  cdp: BrowserCdp,
  wc: WebContents,
  run: () => Promise<T>,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(Object.assign(
        new Error(`browser ${label} timed out after ${BROWSER_CDP_TIMEOUT_MS}ms`),
        { code: "TIMEOUT" },
      ));
      try { cdp.detach(wc); } catch { /* preserve timeout result */ }
    }, BROWSER_CDP_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(run), timedOut])
    .finally(() => { if (timeout) clearTimeout(timeout); });
}
