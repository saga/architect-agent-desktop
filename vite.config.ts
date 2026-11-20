import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function rendererContentSecurityPolicy(mode: string) {
  const development = mode !== "production";
  const directives = [
    "default-src 'self'",
    development
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    development
      ? "connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173"
      : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'none'",
  ];
  return directives.join("; ");
}

export default defineConfig(({ mode }) => {
  const contentSecurityPolicy = rendererContentSecurityPolicy(mode);

  return {
    base: "./",
    plugins: [
      react(),
      {
        name: "renderer-content-security-policy",
        transformIndexHtml: {
          order: "post" as const,
          handler(html: string) {
            const meta = `    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">\n`;
            return html.replace("</head>", meta + "  </head>");
          },
        },
      },
    ],
    build: {
      outDir: "dist/renderer",
      emptyOutDir: false,
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
  };
});
