import type { ReactNode } from "react";

function MarkdownLink({ href, title, children }: { href?: string; title?: string; children?: ReactNode }) {
  const target = typeof href === "string" ? href : "";
  return <a href={target} title={title}
    onClick={event => {
      if (!target) return;
      event.preventDefault();
      if (target.startsWith("#")) {
        document.getElementById(target.slice(1))?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      let url: URL;
      try { url = new URL(target); } catch { return; }
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) return;
      void window.browser.openExternal(url.toString()).catch(() => undefined);
    }}>{children}</a>;
}
export const markdownComponents = { a: MarkdownLink };
