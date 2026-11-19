# Layout Engine Architecture

Status: implementation foundation / incremental rollout  
Target: Electron 45 + React 19 + TypeScript

## Decision

Build an application-owned, renderer-agnostic layout engine. Do not adopt a DOM docking library as the authority for Electron native view geometry.

The engine is a pure TypeScript geometry and workspace-state layer. Adapters apply its output to:
- Electron `WebContentsView.setBounds()`
- React DOM panel containers
- transient native overlay views
- future floating/popped-out BrowserWindows

The main process is the final authority for native View bounds and stacking. Renderer measurements are inputs only; they are validated and converted into a logical-pixel viewport.

## Reference projects and what to reuse

| Project | Reuse | Do not delegate |
|---|---|---|
| Dockview | split/tab/group UX, serialization, floating group concepts | native Electron View bounds |
| Golden Layout | component tree, drag/drop docking, focus and layout persistence | native View stacking |
| panes | pure geometry engine separated from renderer | its Rust/Taffy implementation as a new runtime dependency |
| Splitser | browser-specific split pane behavior | its `<webview>` embedding approach |
| Electron WebContentsView | native view composition and bounds API | application-level workspace policy |

## Architecture

```text
Workspace State / Layout Tree (versioned JSON)
                 |
                 v
          Layout Engine (pure TS)
                 |
        LayoutResult: id -> Rect
                 |
        +--------+---------+
        |                  |
        v                  v
 Electron View Adapter   DOM Adapter
        |                  |
 WebContentsView         React panels
        |
 Native View Stack Manager
        |
 Browser / Agent / Overlay views
```

### Core responsibilities

1. Layout model: nested horizontal/vertical splits and panel constraints.
2. Geometry solver: deterministic rectangles, min/max constraints, hidden nodes, overflow reporting.
3. Workspace state: active panel, visibility, ratios, restore and migration.
4. Interaction controller: resize handles, drag/drop docking, maximize/restore, focus.
5. Electron adapter: maps logical rectangles to native View bounds and owns z-order.
6. DOM adapter: applies the same rectangles to React surfaces where a native view is not needed.
7. Persistence: versioned JSON with validation and safe fallback.

The current implementation includes the pure geometry kernel, a version-1 persistence record for Agent panel width/visibility, a resizable Agent panel splitter, and a main-process adapter that computes the Browser WebContentsView bounds from a horizontal split. The tree utility layer now also supports safe panel docking (left/right/top/bottom), split-ratio updates, visibility changes, panel removal with parent collapse, tree normalization, and duplicate-ID validation. These are model operations; the renderer does not yet expose drag docking. AgentPanel remains a React DOM panel; its rectangle is represented by the same split model and CSS grid track. Moving AgentPanel into a WebContentsView is a later adapter change, not a prerequisite for sharing layout state.

## Layout model

The canonical model is a binary split tree:
- `panel`: stable id and min/max dimensions / visibility.
- `split`: horizontal or vertical axis, ratio, first and second child, splitter thickness.

This supports nested layouts without coupling the model to React or Electron. The current browser tab strip is still a browser-specific tab bar, not a workspace Tab Group. Workspace Tab Groups need an explicit group node with active-tab state and serialization before they can be called implemented. Floating panels likewise require separate roots, native BrowserWindow ownership, and redocking; they are not implemented yet.

All coordinates are logical pixels (DIP). The main process clamps rectangles to the BrowserWindow content area before calling Electron. Device scale factor is applied only at raster boundaries, not in the persisted layout model.

## Current integration

The existing toolbar and tab chrome remain in the renderer. Renderer reports the content viewport rectangle. The main process passes that rectangle through the layout engine and applies the resulting `browser` rectangle to the active WebContentsView.

This preserves the current UI while replacing ad-hoc bounds arithmetic with a deterministic engine. Subsequent phases move the Agent panel and overlay into the shared tree and let the engine compute both rectangles.

## Phased implementation

### Phase 1 — Geometry kernel
- pure layout tree and deterministic solver
- min/max constraints, visibility, zero-size and undersized viewport handling
- validation and unit tests

### Phase 2 — Main-process adapter
- one layout authority for active Browser WebContentsView
- bounds clamping and resize coalescing
- diagnostics for layout version, duration and overflow

### Phase 3 — Workspace interactions
- [x] persist Agent panel width and visibility (version 1)
- [x] draggable splitter, keyboard resize, visibility toggle
- [x] pure split-ratio, dock, remove/collapse, visibility and normalization operations
- [ ] renderer drag/drop targets and docking preview
- [ ] persist the complete nested tree and restore/migrate it
- [ ] keyboard focus order and panel activation

### Phase 4 — Native view composition
- Agent panel WebContentsView and overlay view adapters
- centralized child-view order and focus restoration
- live overlay and Snapshot coordinator integration

### Phase 5 — Advanced workspace
- [ ] workspace Tab Groups (distinct from the browser's web-tab strip)
- [ ] floating roots, detached BrowserWindows, redocking, maximize/restore
- [ ] migration and recovery for full-tree persisted layouts
- [ ] cross-platform interaction and performance tests

## Invariants

- Main process is the sole writer of native WebContentsView bounds and stacking.
- No renderer-provided arbitrary WebContents id or View reference.
- Invalid layout input never reaches Electron APIs.
- Hidden panels have no native hit target.
- A panel must not receive negative, NaN or out-of-window bounds.
- Closing a panel releases its native view and listeners.
- Snapshot is an interaction mode, not a layout primitive.
- Layout persistence contains identifiers and geometry, never WebContents instances or page content.

## Acceptance criteria

- Same tree + same viewport always yields same rectangles.
- Every visible panel rectangle is finite, non-negative and within the assigned viewport.
- Min constraints are respected when feasible; otherwise overflow is explicit and deterministic.
- Hiding either side of a split gives the remaining visible side the full rectangle.
- Repeated resize/activate/close cycles do not leave stale bounds or detached views.
- Layout JSON can be validated and safely restored after app restart.\n- Agent panel width and visibility persist across application restarts.
- Electron adapter tests cover z-order and view lifecycle separately from geometry tests.
