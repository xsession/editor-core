# Advanced Visual Engine Research and Upgrade Plan

## Executive recommendation

`editor-core` should stay framework-neutral at its semantic layer, but it should no longer rely on one rendering path or full-document scans for interactive work. The strongest architecture is a three-layer system:

1. **Semantic editor core** — document, commands, validation, geometry, labels, ports and deterministic built-in routing.
2. **High-performance scene/runtime layer** — spatial index, viewport culling, level-of-detail, connectivity maps, cached render plans and incremental invalidation.
3. **Pluggable backends** — Canvas2D as the dependency-free default interactive renderer, PixiJS for very large GPU-driven scenes, and optional ELK/libavoid routing adapters for graph layout and object-avoiding connector routing.

This avoids coupling the core to React, DOM/SVG, WebGL, or a particular routing engine. It also allows applications such as `pin_configurator`, FlowLab-style editors, CAD/wiring editors, state-machine editors, and web UI designers to share the same interaction and geometry engine.

## Baseline audit of `xsession/editor-core`

The repository currently stores a compiled JavaScript/declaration bundle under `editor-core/`; the root has no package manifest or normal source tree. The root README is empty. This makes dependency management and build/test reproducibility a priority before adding mandatory third-party frameworks.

The current implementation already contains several strong foundations:

- a deterministic orthogonal visibility-grid router with A* search, bend/crossing/proximity penalties, manual constraints, lead-ins and route stability;
- a framework-neutral `UniformGridIndex`;
- CAD-style hit testing and marquee selection;
- component geometry and port geometry;
- label placement and validation;
- an SVG renderer suitable for export and deterministic snapshots.

The main performance issue is that the existing broad-phase index is not used by `hitTestDocument()` or marquee selection. Interactive hit testing still walks every component, every label, every wire, and every segment. The scene derivation path also discovers connected ports by scanning all wires once per component, which is O(components × wires) before geometry/routing work even begins.

The SVG renderer is valuable for export, printing, accessibility and deterministic snapshots, but rebuilding a large SVG string is not the best primary renderer for a high-frequency interactive canvas.

## Framework and library comparison

| Technology | Best role | Strengths | Weaknesses / reason not to make it the core |
|---|---|---|---|
| **Canvas2D** | Default interactive renderer | No dependency, fast immediate-mode drawing, simple worker/offscreen path, easy dirty-layer strategy | CPU rasterization; very large scenes eventually benefit from GPU batching |
| **PixiJS 8** | Optional high-end GPU renderer | WebGL/WebGPU-oriented batching, culling support, retained render instructions, strong large-scene performance | Adds a substantial rendering dependency and GPU-specific lifecycle |
| **Konva** | Optional application-facing Canvas scene graph | Mature interaction model, layers, caching, hit canvas, thousands of shapes | Per-node object/event cost can become significant; less attractive than a thin custom core for CAD-scale scenes |
| **tldraw** | Architecture reference / full whiteboard SDK | Excellent spatial indexing, geometry caching, viewport culling, LOD and large-canvas interaction design | It is a complete editor SDK with its own document/store/shape model; embedding it inside `editor-core` would duplicate semantic ownership |
| **React Flow / xyflow** | Optional React adapter for node-flow UIs | Excellent handles, reconnectable edges, custom edges and React ecosystem | React/SVG-centric; not ideal for framework-neutral CAD or tens-of-thousands-of-primitives rendering |
| **ELK / elkjs** | Automatic graph layout and routed block diagrams | Layered layout, crossing minimization, port constraints, orthogonal/polyline/spline routing | Designed primarily for layout passes rather than low-latency per-pointer interactive rerouting |
| **libavoid** | Interactive obstacle-avoiding connector backend | Purpose-built orthogonal/polyline routing, transactions, routing penalties, nudging, connection pins | Native C++ library; browser use needs WASM/bindings and should remain optional |

## What the strongest projects are doing

### tldraw

tldraw documents viewport culling, reactive dependency tracking, cached shape geometry and level-of-detail for large canvases. Its 4.4 release also moved large-canvas spatial queries to an R-tree and skips hover hit-testing while the camera is moving. These are directly applicable to `editor-core`: broad-phase spatial queries should be mandatory in pointer paths, and geometry/render fidelity should depend on viewport and zoom.[^1][^2]

### PixiJS 8

PixiJS recommends application-level culling when it helps, batching compatible objects, avoiding unnecessary event-tree traversal, and minimizing expensive masks/filters. PixiJS 8 also reuses render instructions when a scene graph is unchanged and updates only changed transforms. For `editor-core`, this supports a backend-neutral render-plan cache and an optional Pixi adapter rather than coupling document state to Pixi objects.[^3][^4]

### Konva

Konva's guidance is consistent: draw as little as possible, keep a small number of meaningful layers, disable listening for noninteractive content, cache complex stable groups, and cull objects outside the viewport. This is a good reference for a Canvas2D backend, but `editor-core` can implement these ideas with fewer retained objects.[^5]

### React Flow

React Flow is strongest as an application adapter where nodes are React components and handles/edge reconnection are important. Its own performance guidance focuses on avoiding unnecessary rerenders and simplifying complex edge/node styles. It should be an adapter, not the underlying semantic/render core.[^6]

### ELK

ELK Layered supports straight, orthogonal and spline routing, arbitrary port constraints, compound graphs and crossing minimization. This is valuable for an explicit **auto-layout** command or background layout operation. It should not replace the fast local router used while dragging a component or reconnecting a wire.[^7][^8]

### libavoid

libavoid is specifically designed for fast object-avoiding orthogonal/polyline connectors in interactive diagram editors. Its router supports transactions so many object moves/adds/removals can be batched and rerouted once, plus routing penalties and nudging. That makes it an excellent optional WASM/native backend for dense engineering diagrams.[^9][^10]

## Architecture implemented in this patch

### 1. `SceneSpatialIndex`

A reusable multi-kind broad-phase index now stores:

- component bounds;
- port hit targets;
- label bounds;
- full wire bounds;
- individual route segments;
- route waypoints.

This allows hit tests and marquee operations to examine only nearby candidates instead of scanning the document. Exact geometry checks still happen after the broad phase, preserving deterministic CAD behavior.

### 2. Indexed hit testing and marquee selection

`hitTestDocumentIndexed()` and `marqueeSelectIndexed()` preserve existing result/selection semantics while changing the hot path from full-document iteration to broad-phase candidate queries.

Expected complexity becomes approximately **O(query + local candidates)** rather than **O(all components + all labels + all wire segments)** for typical pointer operations.

### 3. One-pass connectivity index

`buildConnectivityIndex()` constructs component→ports, component→wires, port→wires and wire→port-endpoint maps in one pass over wires. `deriveEditorSceneOptimized()` uses it when building component geometry, eliminating the previous component-by-component wire scan.

### 4. Viewport culling and level of detail

`queryVisibleScene()` and `buildVisualRenderPlan()` create a backend-neutral visible-scene plan. Three LOD levels are included:

- **low** — component bodies and wires;
- **medium** — adds primary labels/titles;
- **full** — adds ports, secondary labels and detail.

Selected entities can be pinned so direct manipulation remains stable near viewport edges.

### 5. Canvas2D backend

`Canvas2DRenderer` is an immediate-mode renderer intended for interaction. It consumes the culled render plan instead of walking the document. It includes:

- adaptive grid drawing;
- engineering wire paint layers;
- selection outlines;
- component bodies/headers/titles;
- full-LOD ports;
- labels and leaders;
- device-pixel-ratio handling;
- renderer metrics.

SVG remains the best export backend; Canvas2D becomes the better default for high-frequency interaction.

### 6. Pluggable visual and routing backends

`VisualBackendRegistry` allows host applications to register renderer and router backends without adding hard dependencies to `editor-core`.

The patch includes data adapters for:

- **ELK** through `createElkGraph()` and `routesFromElkResult()`;
- **libavoid/WASM** through `createLibavoidRequest()`;
- any renderer that consumes `VisualRenderPlan`, including a future PixiJS or Konva adapter.

## Recommended next implementation phases

### Phase A — make the optimized runtime the default

After compatibility tests, route the existing engine interaction layer through `SceneSpatialIndex` automatically. The old full-scan functions should remain available as deterministic reference implementations for regression testing.

### Phase B — incremental invalidation

Track invalidation domains separately:

- component geometry dirty;
- routing obstacles dirty;
- connected wire routes dirty;
- labels dirty;
- validation dirty;
- render primitive dirty.

A component drag should not rebuild unrelated component geometry, labels, or routes.

### Phase C — route-segment spatial index inside the built-in A* router

The built-in router currently tests candidate segments against obstacle arrays and existing routes. Introduce local obstacle and segment queries so proximity/crossing costs only inspect nearby objects. Reuse visibility graphs while an obstacle set is unchanged.

### Phase D — worker routing

Route dense bundles and run ELK/libavoid in a Worker. Pointer interaction can display the built-in fast preview route immediately and swap in the higher-quality route when the worker result returns, guarded by document revision.

### Phase E — PixiJS 8 adapter

For very large diagrams, create a Pixi backend that consumes the same render plan. Recommended design:

- one container for static grid/background;
- batched wire graphics grouped by style;
- components grouped by style/LOD;
- bitmap text or cached text at low/medium zoom;
- interaction overlay separate from engineering content;
- culling based on `SceneSpatialIndex`, not a second independent spatial model.

### Phase F — production source/build structure

Restore or add the TypeScript `src/` tree, `package.json`, build scripts, generated-output policy, unit tests and benchmarks. Committing only compiled JS + declarations makes future optimization harder and risks divergence between runtime, declarations and source maps.

## Performance targets

These are engineering targets, not measured claims:

| Scenario | Target |
|---|---:|
| Pointer hit test, 10k components / 20k wires | p95 < 1 ms on a modern desktop when local candidate count is small |
| Marquee selection over small viewport region | p95 < 4 ms |
| Pan/zoom with 1k visible engineering primitives | 60 FPS target |
| Large document, most objects off-screen | render cost proportional to visible set, not total document size |
| Drag component with 10–30 connected wires | immediate preview each frame; high-quality reroute asynchronously if required |

`benchmarks/spatial-benchmark.mjs` is included as a synthetic baseline for index construction and local queries. A production benchmark suite should also compare indexed vs full-scan hit testing with representative wiring density.

## Selection of default technologies

For `editor-core` itself:

- **Default drawing:** Canvas2D renderer + SVG export.
- **Optional GPU drawing:** PixiJS 8 adapter.
- **Default local routing:** current deterministic built-in router, improved with spatial broad phases.
- **Optional global layout:** ELK/elkjs.
- **Optional dense interactive routing:** libavoid through native/WASM adapter.
- **React/React Flow/tldraw:** host-level adapters only, not semantic dependencies.

This keeps the core reusable across Astro, Qt/webview, plain browser, React, Electron, embedded tooling UIs and future rendering engines.

## Sources

[^1]: tldraw, “Performance,” https://tldraw.dev/sdk-features/performance
[^2]: tldraw, “v4.4.0,” https://tldraw.dev/releases/v4.4.0
[^3]: PixiJS, “Performance Tips,” https://pixijs.com/8.x/guides/concepts/performance-tips
[^4]: PixiJS, “Culler Plugin,” https://pixijs.com/8.x/guides/components/application/culler-plugin
[^5]: Konva, “All Performance Tips,” https://konvajs.org/docs/performance/All_Performance_Tips.html
[^6]: React Flow, “Performance,” https://reactflow.dev/learn/advanced-use/performance
[^7]: Eclipse Layout Kernel, “ELK Layered,” https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
[^8]: Eclipse Layout Kernel, “Edge Routing,” https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeRouting.html
[^9]: Adaptagrams, “libavoid — Overview,” https://www.adaptagrams.org/documentation/libavoid.html
[^10]: Adaptagrams, “Avoid::Router Class Reference,” https://www.adaptagrams.org/documentation/classAvoid_1_1Router.html

## Phase 2 improvements implemented

The second optimization pass extends the first patch from broad-phase culling into the editor's routing, connection and update hot paths.

### Indexed wire-crossing detection

The original `findWireCrossings()` compares every visible wire pair and then every segment pair. This is correct but scales poorly in dense harness diagrams. The patch adds `findWireCrossingsIndexed()`, which indexes route segments and only performs exact intersection checks for overlapping segment bounds. Crossing results are de-duplicated by wire pair and crossing coordinate.

This is especially important because crossing detection is part of scene derivation and also drives bridge/jump-over rendering.

### Locality-aware routing with correctness fallback

`RoutingSpatialAccelerator` maintains separate indices for obstacles and routed wire segments. `routeWireAccelerated()` first routes against a local search window containing only nearby obstacles and routes. It then verifies the result against the global obstacle index. If the local route is invalid, the search window expands geometrically and finally falls back to the full existing router.

This preserves the deterministic core router as the correctness authority while avoiding full-document obstacle/crossing scans for typical local edits.

### Incremental scene runtime

`IncrementalSceneRuntime` keeps derived state across document revisions. When the host provides the existing `MutationImpact`, it:

- rebuilds geometry only for changed components;
- expands a dirty region from old and new component bounds;
- reroutes directly connected wires plus wires spatially intersecting that dirty region;
- reuses untouched routes;
- reflows only labels anchored to changed entities or intersecting the dirty region until a configurable threshold triggers a full label pass;
- updates the spatial index per component/wire/label owner;
- uses indexed crossing detection;
- exposes an already-culled render-plan path.

This is the largest architectural performance change in phase 2. The editor can now make a component drag proportional to the local dependency neighborhood instead of proportional to the entire document in the common case.

### Magnetic connection targeting

`connection-intelligence.js` adds a connection UX layer above the existing port validation rules:

- spatially queried nearby port magnets;
- screen-space snap radius;
- electrical-class affinity;
- source/target port-facing affinity;
- existing `canConnectPorts()` validation;
- ranked target candidates;
- acquisition/release hysteresis to stop target flicker;
- routed connection previews using the same routing semantics as committed wires.

This follows the useful separation seen in maxGraph/X6: connection-point selection is not the same concern as edge routing, and connector rendering is not the same concern as either of those.

### Bundle/harness lanes

The base model already exposes `preferSharedChannels`, but the current core does not use that option in its router. `bundle-routing.js` adds stable orthogonal lane assignment for cable bundles, buses and large pin-bank fanouts. The lane result can be converted into strong corridor constraints for the normal router, preserving the existing route data model.

### Router vs connector appearance

`connector-paths.js` separates route topology from how a route is drawn. It provides:

- polyline connectors;
- rounded orthogonal connectors;
- smooth cubic connectors;
- crossing jump-over bridges;
- an extensible connector-path registry.

This mirrors the router/connector split found in X6 and maxGraph and prevents the routing layer from becoming coupled to SVG/Canvas/Pixi drawing details.

### PixiJS 8 backend

`pixi8.js` is an optional injected backend. It does not add PixiJS as a core dependency. The adapter:

- reuses per-entity Pixi display objects;
- fingerprints geometry/style and avoids rebuilding unchanged `Graphics`;
- consumes the same viewport-culled LOD render plan as Canvas2D;
- supports PixiJS' WebGL/WebGPU renderer choice at the host level;
- destroys objects that leave the visible plan;
- keeps the semantic editor state outside the Pixi scene graph.

This follows PixiJS v8's recommendation to avoid clearing and rebuilding complex Graphics objects every frame.

### Canvas2D path caching

The Canvas2D renderer now uses `Path2D` when available and caches wire paths by route revision. Multi-layer engineering wire paint can therefore stroke the same path repeatedly without rebuilding the path for selection, warning, outline and engineering-color layers.

### Performance instrumentation

`EditorPerformanceMonitor` provides bounded p50/p95/p99 phase statistics and `FrameBudgetController` lets optional work be gated against a 60-FPS frame budget. Instrumentation should be wired into:

- scene update;
- route search;
- crossing detection;
- label placement;
- validation;
- render-plan construction;
- Canvas2D/Pixi rendering.

## Updated recommended runtime selection

| Document / workflow | Recommended renderer | Recommended router |
|---|---|---|
| Small/medium engineering diagram | Canvas2D | Built-in router |
| Large diagram, mostly off-screen | Canvas2D + spatial culling + LOD | Accelerated built-in router |
| Very large visible scene / high visual density | PixiJS 8 adapter | Accelerated built-in router |
| Block-diagram auto-layout | Canvas2D or PixiJS | ELK pass, then local built-in routing |
| Dense cable/harness editor | Canvas2D or PixiJS | Bundle lanes + built-in router; optional libavoid/WASM |
| Export / print / deterministic snapshot | SVG | Existing saved routes |

## Additional current references

- tldraw 4.4 moved large-canvas shape queries to an R-tree and moved selection/hover indicators from SVG to Canvas2D, reporting up to 25x faster indicator rendering in some cases: https://tldraw.dev/releases/v4.4.0
- PixiJS v8 Graphics guidance recommends reusing Graphics/GraphicsContext instead of clearing and rebuilding complex graphics every frame: https://pixijs.com/8.x/guides/components/scene-objects/graphics
- maxGraph separates edge routing styles from edge handlers and orthogonal perimeter projection: https://maxgraph.github.io/maxGraph/docs/usage/edge-styles/
- AntV X6 separates routers (`orth`, `manhattan`, `metro`, etc.) from connectors and supports custom routers: https://x6.antv.antgroup.com/en/tutorial/basic/edge
- libavoid exposes crossing, segment, port-direction, shared-path and nudging penalties/options suitable for an optional high-quality routing backend: https://www.adaptagrams.org/documentation/router_8h.html

## Second implementation pass

The first patch established spatially indexed interaction, culling/LOD, Canvas2D rendering and pluggable routing/render backends. The second pass adds the missing production-scale runtime mechanics:

- multi-resolution spatial indexing for mixed-size objects;
- incremental connectivity mutation instead of rebuilding maps on every edit;
- owner-level render-plan diffing and dirty-region repaint;
- partial Canvas2D clearing/clipping;
- a retained PixiJS 8 adapter;
- coalescing priority routing scheduling and LRU route cache;
- worker routing client/protocol/pool;
- stable bus/harness lane routing;
- magnetic connection target scoring/hysteresis;
- connector appearance strategies including jump-over bridges;
- a unified `HighPerformanceVisualRuntime` for host applications;
- explicit performance metrics and frame-budget helpers.

### Validation snapshot

A standalone validation harness exercised 10,000 small spatial objects plus a very large object, incremental connectivity changes, render diffing, routing task coalescing/cache reuse, worker messaging, bundle routing, jump-over connector generation and retained Pixi display-object reuse. The test completed successfully.

A synthetic connectivity benchmark with 20,000 wires and 3,000 endpoint changes measured about 16.5 ms total for the updates in this environment (roughly 5.5 microseconds per changed wire). Treat this as a regression baseline, not a cross-machine performance claim.

The mixed spatial benchmark demonstrated the tradeoff expected from a multi-resolution index: finer single-grid point/area queries can be slightly cheaper, while adaptive storage bounds the fan-out cost of large geometry and can reduce build cost. The runtime therefore keeps the spatial strategy configurable.
