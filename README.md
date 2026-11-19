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
- **Renderer:** local React UI for the tab strip, navigation toolbar and address bar.

Remote pages run with nodeIntegration: false, contextIsolation: true and sandbox: true. The renderer is not allowed to send arbitrary IPC messages; only the methods in the preload API are exposed.

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
