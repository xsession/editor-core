# editor-core Performance Architecture v2

## Goal

Make `editor-core` suitable as the shared visual engine behind dense engineering applications such as pin configurators, wiring/harness editors, state-machine editors, system block editors and RouteCore-like CAD tools without forcing React, SVG, PixiJS, ELK or libavoid on every host.

## Runtime pipeline

```text
EditorDocument
    |
    v
MutableConnectivityIndex
    |
    v
IncrementalSceneRuntime
    |-- changed component geometry only
    |-- local accelerated reroutes
    |-- partial label reflow
    |-- indexed crossing detection
    v
IncrementalSceneSpatialIndex
    |-- AdaptiveSpatialIndex
    |-- components / ports / labels
    |-- wires / route segments / waypoints
    v
VisualRenderPlan (viewport + LOD)
    |
    +--> RetainedRenderState -> dirty regions
    |
    +--> Canvas2DRenderer (default interaction)
    +--> Pixi8Renderer (optional very-large GPU scenes)
    +--> SVG renderer (export / deterministic snapshot)
```

## Why multi-resolution spatial indexing

The original uniform grid is excellent for similarly sized component and label rectangles. Engineering diagrams also contain pathological geometry:

- very long orthogonal wire segments;
- buses crossing a large sheet;
- large groups/frames;
- page-sized imported backgrounds;
- keepout regions;
- annotations spanning many component rows.

A single fine grid stores those objects in many buckets. `AdaptiveSpatialIndex` instead picks the smallest grid level that stays below configured bucket fan-out limits. Large objects move to coarser grids, and extreme objects move to a small overflow set.

This preserves fast fine-grained queries while bounding insertion/memory cost.

## Incremental connectivity

A visual editor performs many mutations that do not change most connections. Rebuilding component→wire and port→wire maps after every pointer update is unnecessary.

`MutableConnectivityIndex` supports:

- `upsertWire()`;
- `removeWire()`;
- `applyDocumentWires()`;
- `wiresForComponent()`;
- `wiresForPort()`;
- `connectedPortIds()`.

A reconnect now updates two endpoint relationships rather than traversing all wires.

## Dirty-region rendering

`RenderPlanDiffer` compares stable owner-level render tokens. It tracks dirty bounds for:

- moved/resized/restyled components;
- changed wire routes/status/selection;
- changed labels.

`DirtyRegionTracker` merges nearby rectangles and collapses excessive fragmentation. Canvas2D accepts the resulting world-space dirty regions, clears only those regions, clips rendering to them, then redraws the visible plan inside the clip.

Camera and LOD changes deliberately cause a full repaint because the entire raster mapping changes.

## Routing pipeline

### Immediate path

The existing deterministic orthogonal router remains the primary local router. `RoutingSpatialAccelerator` narrows obstacle and existing-route candidates to a local search window, expands that window when necessary and falls back to the full routing context for correctness.

### Gesture scheduling

`RoutingTaskScheduler` provides:

- priority ordering;
- same-wire task coalescing;
- frame-budget draining;
- optional LRU result caching;
- cached environment revision keys.

This prevents five pointer-move reroute requests from consuming time when only the newest result is useful.

### Worker path

`RoutingWorkerClient` and `RoutingWorkerPool` move expensive routing/layout out of the UI thread. They support:

- revision tagging;
- per-wire superseding;
- cancellation;
- backend-neutral payloads;
- async built-in, ELK or libavoid routing.

A practical host can show a low-cost local preview immediately, then replace it with the worker result only if the result revision is still current.

## Rendering strategy

### Canvas2D

Use for the default interactive renderer because it has no mandatory dependency and works well with:

- viewport culling;
- LOD;
- Path2D wire caching;
- partial repaint;
- OffscreenCanvas in worker-capable hosts.

### PixiJS 8

Use when the visible scene is sufficiently large that GPU batching is valuable. `Pixi8Renderer` is dependency-injected so `editor-core` stays free of a hard Pixi dependency. It retains display objects and rebuilds Graphics only when an entity fingerprint changes.

### SVG

Keep for:

- file export;
- printing;
- accessibility-oriented host output;
- deterministic visual snapshots;
- small static scenes.

Do not make complete SVG-string regeneration the high-frequency drag renderer for very large scenes.

## Connection UX

The optimized connection flow contains:

1. spatially query nearby port candidates;
2. rank by screen-space distance;
3. include electrical compatibility;
4. include port-facing affinity;
5. validate actual connectivity rules;
6. apply magnetic acquisition/release hysteresis;
7. generate a route preview;
8. commit only the final connection.

This is more stable than nearest-point-only snapping when dense pin banks are close together.

## Advanced engineering connectors

`bundle-routing` adds stable lane assignment for buses/harnesses. `connector-paths` separates route topology from appearance and supports:

- polyline;
- rounded orthogonal;
- smooth curve;
- jump-over bridge rendering.

This separation is important: a route should remain electrically/topologically deterministic while the host can change visual connector style without recalculating connectivity.

## HighPerformanceVisualRuntime

Hosts should normally integrate this class rather than manually composing every module.

Typical flow:

```js
const runtime = new HighPerformanceVisualRuntime();
runtime.reset(document);

// On a document mutation:
runtime.update(nextDocument, mutationImpact);

// On a frame:
const { plan, diff, result } = runtime.render(canvas, {
  viewport,
  zoom,
  selection,
});

// On pointer move:
const hits = runtime.hitTest(worldPoint, { zoom });
```

The same runtime can register a Pixi renderer or router backend later without replacing document semantics.

## Remaining high-value work

1. Restore actual TypeScript sources and package/test infrastructure.
2. Integrate the optimized runtime directly into `HarnessEditorEngine` so mutation impacts are guaranteed complete.
3. Add dependency revisions to routing obstacles so cached route validity is explicit.
4. Add WebAssembly libavoid integration and compare quality/performance against the built-in router.
5. Add ELK auto-layout command with undo/redo transaction support.
6. Add a real browser benchmark app with 1k / 10k / 50k components and representative wire density.
7. Add visual regression tests for crossing bridges, bundles, dense pin banks, labels and LOD transitions.
8. Add optional typed-array render plans for a custom WebGL/WebGPU backend if Pixi overhead becomes material.
