# Architect Agent Desktop

A cross-platform Electron desktop application. The first milestone is a built-in, multi-tab Chromium browser that will serve as the foundation for the desktop agent workspace.

## Current scope

- Multi-tab browsing with tab creation, switching and closing.
- Address bar with direct navigation and web search.
- Back, forward, reload and stop controls.
- Links opened by websites in new windows are opened as new tabs.
- Persistent browser profile for cookies, cache and site storage.
- File downloads through Chromium's native download flow.
- Find in page, page context menu and common browser keyboard shortcuts.
- Per-session permission prompts for media, screen capture, geolocation, notifications and clipboard read.
- Isolated browser processes: remote pages do not receive Node.js access.
- Local declarative plugin directories: import, validate, enable/disable, export and remove. Enabled plugin Skills and Workflow templates are included in Agent instructions; plugins cannot execute arbitrary code.

This is the browser foundation, not a complete replacement for Chrome, Edge or Firefox. Browser extensions, cross-device sync, password import, bookmark management and advanced privacy controls are not included yet.

## Requirements

- Node.js 22.12 or newer.
- npm.
- macOS or Windows for native packaging. Development can also run on Linux.

## Development

    npm install
    npm run dev

The Vite renderer and Electron main process run as separate development processes.

## Build

    npm run typecheck
    npm run build

The compiled application is written to the dist/ directory.

## Package for desktop

On macOS:

    npm run package:mac

This produces DMG and ZIP distributions for Apple Silicon and Intel Macs.

On Windows:

    npm run package:win

This produces a per-user NSIS installer and a portable executable for x64 and ARM64.

### Running without administrator privileges

**Windows:** the NSIS installer is configured for per-user installation (perMachine: false) and does not request elevation. The portable build can be run without installing the application.

**macOS:** use the ZIP or DMG build and keep the application in a directory writable by the current user, such as ~/Applications. Moving an app into the system-wide /Applications directory may require an administrator depending on the machine's policy. The app does not install privileged services or system-wide components.

Unsigned builds may trigger the operating system's normal security warnings. Production distribution should add code signing and notarization; signing credentials are intentionally not included in this repository.

## Architecture

- **Main process:** owns the application window, tab lifecycle, navigation, downloads, permission prompts and native menus.
- **Browser content:** each tab is a WebContentsView. Tabs share one persistent Chromium session while keeping separate web contents.
- **Preload:** exposes a narrow, typed IPC API using contextBridge; it does not expose raw Electron APIs.
- **Renderer:** local React UI for the tab strip, navigation toolbar, address bar and Agent/plugin settings.
- **Plugin host:** stores local plugin directories under the application user-data directory, validates manifests and referenced resources, and exposes only host-known tool/view identifiers. Plugin content is data, never executable code.

Remote pages run with nodeIntegration: false, contextIsolation: true and sandbox: true. The renderer is not allowed to send arbitrary IPC messages; only the methods in the preload API are exposed.

## Plugins

Open **Agent 与插件配置** from the application settings, then import a plugin directory. The repository includes a working example at `examples/plugins/research-assistant`.

A plugin directory contains `manifest.json` plus the resource files referenced by that manifest. The first version supports Skills (`.md`), Workflow templates (`.md` or `.json`), references to host-provided tools, and JSON declarations for the existing Browser or Agent views. Arbitrary JavaScript is never loaded or executed.

Imported plugins are stored locally under the application's user-data directory. Enable/disable state is local to this installation. Export writes a copy of the plugin directory to a folder you choose.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl + T | New tab |
| Cmd/Ctrl + W | Close active tab |
| Cmd/Ctrl + L | Focus address bar |
| Cmd/Ctrl + R | Reload active tab |
| Cmd/Ctrl + F | Find in page |
| Cmd/Ctrl + Tab | Next tab |
| Cmd/Ctrl + Shift + Tab | Previous tab |
| Cmd/Ctrl + 1–8 | Select tab 1–8 |
| Cmd/Ctrl + 9 | Select last tab |
| Alt + Left / Right | Back / forward |

## Notes

- The browser profile is stored under Electron's user data directory.
- Site permission approvals last for the current app session. Unsupported permissions are denied by default.
- No auto-update service, telemetry or remote account service is configured.

## Copilot Agent

The application integrates the official Node.js GitHub Copilot SDK in the Electron main process. The renderer talks to it through a narrow preload API; browser tabs never receive SDK or Node.js access. IPC request payloads are validated with Zod.

The chat surface uses Ant Design and Ant Design X. The SDK's signed-in-user authentication uses stored credentials from a GitHub Copilot CLI login. VS Code sign-in alone is not a documented credential source; sign in to Copilot CLI if the SDK reports that no credentials are available. The SDK package includes its compatible CLI runtime.

The agent panel is docked on the **right side** of the browser. It can inspect the active page (title, URL, visible text, headings, links and controls), list and switch tabs, navigate or open tabs, scroll, click ordinary UI/navigation elements, and fill non-password fields without submitting forms. These browser capabilities are exposed as explicit Copilot SDK tools implemented in the Electron main process; the remote page cannot access them directly.

The agent treats page content as untrusted input. It is intentionally prevented from submitting forms or performing purchases, payments, message sending, publishing, deletion, transfers, or account/security changes. Those consequential actions remain under direct user control.
