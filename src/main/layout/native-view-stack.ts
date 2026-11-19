import { BrowserWindow, type Rectangle, type WebContentsView } from "electron";

export type NativeLayer = "browser" | "agent" | "overlay";

interface ManagedView {
  id: string;
  view: WebContentsView;
  layer: NativeLayer;
  visible: boolean;
  bounds: Rectangle;
}

/**
 * Main-process-only owner for native child view attachment, geometry and
 * stacking. Renderer code never receives WebContentsView references.
 */
export class NativeViewStackManager {
  private readonly views = new Map<string, ManagedView>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  register(id: string, view: WebContentsView, layer: NativeLayer = "browser"): void {
    const previous = this.views.get(id);
    if (previous && previous.view !== view) this.detach(previous);
    this.views.set(id, {
      id, view, layer, visible: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    });
  }

  show(id: string): void {
    const item = this.views.get(id);
    const window = this.getWindow();
    if (!item || !window || window.isDestroyed()) return;
    for (const other of this.views.values()) {
      if (other.visible && other.id !== id && other.layer === item.layer) {
        window.contentView.removeChildView(other.view);
        other.visible = false;
      }
    }
    if (!item.visible) {
      window.contentView.addChildView(item.view);
      item.visible = true;
    }
    this.applyBounds(item);
    this.reorder();
  }

  hide(id: string): void {
    const item = this.views.get(id);
    if (!item || !item.visible) return;
    this.detach(item);
  }

  setBounds(id: string, bounds: Rectangle): void {
    const item = this.views.get(id);
    if (!item) return;
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    const x = Math.max(0, Math.min(width, Math.round(bounds.x)));
    const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
    item.bounds = {
      x, y,
      width: Math.max(0, Math.min(width - x, Math.round(bounds.width))),
      height: Math.max(0, Math.min(height - y, Math.round(bounds.height))),
    };
    this.applyBounds(item);
  }

  setLayer(id: string, layer: NativeLayer): void {
    const item = this.views.get(id);
    if (!item) return;
    item.layer = layer;
    this.reorder();
  }

  unregister(id: string, close = false): void {
    const item = this.views.get(id);
    if (!item) return;
    this.detach(item);
    this.views.delete(id);
    if (close && !item.view.webContents.isDestroyed()) item.view.webContents.close();
  }

  closeAll(): void {
    for ( (const item of this.views.values()) ) this.detach(item);
    this.views.clear();
  }

  private applyBounds(item: ManagedView): void {
    if (item.visible && !item.view.webContents.isDestroyed()) item.view.setBounds(item.bounds);
  }

  private detach(item: ManagedView): void {
    const window = this.getWindow();
    if (item.visible && window && !window.isDestroyed()) {
      window.contentView.removeChildView(item.view);
    }
    item.visible = false;
  }

  private reorder(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    const order: Record<NativeLayer, number> = { browser: 0, agent: 1, overlay: 2 };
    const attached = [...this.views.values()].filter((item) => item.visible)
      .sort((a, b) => order[a.layer] - order[b.layer]);
    for (const item of attached) {
      window.contentView.removeChildView(item.view);
      window.contentView.addChildView(item.view);
    }
  }
}
