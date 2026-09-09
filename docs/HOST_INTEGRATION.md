# Host Integration Guide

## 1. Recommended host split

Keep the editor kernel independent of the application shell.

| Layer | Responsibility |
|---|---|
| Domain/database | projects, parts, assemblies, conductors, BOM, migrations |
| Adapter | converts domain entities to and from `EditorDocument` |
| Editor core | geometry, routing, labels, commands, interaction, validation |
| Renderer | SVG or another adapter consuming the same derived scene |
| Host UI | dock panels, toolbar, dialogs, inspector, status, command palette |
| Persistence | SQLite, IndexedDB, filesystem, autosave, recovery |

The core document should contain only information needed for editor behavior and stable visual state. Large part-library records, datasheets, binary images, and manufacturing reports should be referenced by ID rather than embedded repeatedly.

## 2. Render loop

1. Create one `HarnessEditorEngine` per open editor document.
2. Subscribe to `documentChanged`, `selectionChanged`, and `validationChanged`.
3. Render using the current document, component geometries, label placements, selection, and transient overlay.
4. Convert DOM pointer coordinates to world coordinates with the viewport helpers.
5. Forward normalized pointer events to `EditorInteractionController`.
6. Apply emitted pan/cursor/context-menu requests in the host.

Do not mutate `engine.document` directly. Use engine commands or replace the complete document. Read-only views are intentional: direct mutation would bypass history, validation, events, and dependent geometry.

## 3. Gesture overlays

Keep overlays in host transient state rather than in the persisted document:

- marquee rectangle;
- connection preview;
- snap guides;
- hover identity;
- tooltip and status message;
- drag ghost when a host chooses not to render full live geometry.

Pass them through `SvgRenderContext.overlay`, or consume them in a Canvas/WebGL renderer.

## 4. React, Vue, Svelte, and native shells

The engine is an imperative object. Store it outside reactive document proxies. Publish snapshots from engine events into the framework state layer. This avoids proxying Maps, Sets, typed emitters, and large geometry records.

For React, use an external-store adapter. For Vue/Svelte, expose shallow snapshots. For Electron/Tauri, keep the database and filesystem in the privileged process and pass only validated documents/commands across the boundary.

## 5. Web workers

Routing and scene derivation can run in a worker because the document is structured-clone-compatible. Suggested protocol:

```ts
type Request = {
  requestId: string;
  document: EditorDocument;
  options: EditorSceneOptions;
};

type Response = {
  requestId: string;
  documentRevision: number;
  scene: EditorScene;
};
```

Discard a response when its document revision is older than the active revision. During direct manipulation, use a fast local preview route and schedule the full worker route after a short debounce or at pointer release.

## 6. Persistence and recovery

Persist semantic input plus explicit manual state. Derived data such as component geometry and label bounds can be recomputed. Persisting wire route results is optional: it speeds first paint, but a host must mark them stale when endpoints, component geometry, routing settings, or obstacles change.

Recommended local project transaction:

1. begin database transaction;
2. write command envelope and semantic records;
3. update document revision;
4. write optional cached route/placement snapshot;
5. commit;
6. append recovery journal checksum;
7. clear the dirty marker after fsync policy is satisfied.

## 7. Domain adapter rules

Maintain stable IDs across conversions. Never derive editor IDs only from array positions. A pin label may be edited or reordered; its ID must remain unchanged. Store visible designators and labels separately from IDs.

When the domain model removes connected items, translate its policy to one of the editor mutation strategies: prevent, detach, or remap. Do not silently connect to an arbitrary same-index port.

## 8. Large documents

For thousands of entities:

- route affected wires incrementally;
- place only labels within or near the visible world rectangle;
- maintain a `UniformGridIndex` for hit testing and collision queries;
- render SVG by viewport tile or use Canvas/WebGL while retaining the same scene model;
- move routing to a worker;
- debounce expensive validation but run cheap endpoint checks synchronously;
- keep transient pointer previews below one frame of latency;
- preserve a low-detail mode below zoom thresholds.

## 9. Security

Treat imported labels, SVG fragments, and metadata as untrusted. The built-in SVG renderer escapes text and color strings used as attributes, but a host that supports custom raw SVG must sanitize it with an allowlist. Never execute imported scripts, event attributes, external image references, CSS URLs, or foreign objects by default.

## 10. Accessibility

Map the canvas scene to a parallel semantic tree in the host. The SVG includes graphics roles and titles, but keyboard-only editing also needs:

- focusable entity list/tree;
- spoken selection and command feedback;
- keyboard commands for move, rotate, reconnect, and route reset;
- inspector forms with explicit labels;
- error list linked to affected objects;
- color-independent pattern descriptions;
- configurable reduced motion and target size.
