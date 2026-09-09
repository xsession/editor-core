# editor-core v3 production integration

## Scope

This phase integrates the performance architecture at the engine transaction boundary instead of leaving it as optional helper modules.

## JavaScript engine integration

`editor-core/performance-engine.js` exports the package-default `HarnessEditorEngine`. The original generated engine remains available as `LegacyHarnessEditorEngine`.

The optimized engine:

- derives authoritative mutation impact by comparing semantic before/after document state;
- catches under-reported mutations such as wire/label deletion automatically;
- executes incremental scene derivation once per committed command instead of repeating a whole-document recomputation;
- keeps an incremental connectivity index available for connection-limit checks;
- tracks three independent routing revisions:
  - obstacle revision — component/port geometry changed;
  - topology revision — wire endpoints/routing topology changed;
  - environment revision — either domain changed;
- merges dependency-discovered reroutes and label reflows back into the public mutation impact;
- preserves incremental derivation during preview drag frames;
- reuses the final preview scene on commit instead of rerouting the same geometry a second time;
- handles undo/redo through the same dependency-aware runtime.

These revision counters are intended for route-cache keys and worker-result staleness checks.

## ELK transaction backend

`ElkLayoutBackend` dynamically imports `elkjs`; editor-core therefore keeps zero mandatory dependency on ELK.

`applyElkLayoutTransaction()`:

1. converts the derived editor scene into an ELK graph with fixed-position ports;
2. runs ELK layout;
3. moves every affected editor component in one undoable engine transaction;
4. optionally converts routed ELK edge sections into locked manual waypoints.

This is intended for explicit Auto Layout operations rather than pointer-move routing.

## libavoid WebAssembly backend

`LibavoidWasmBackend` dynamically imports `@mr_mint/elkjs-libavoid`.

It supports:

- one-shot obstacle-avoiding routing;
- orthogonal or polyline routing;
- shape buffer distance;
- crossing, segment, reverse-direction and port-direction penalties;
- orthogonal segment nudging;
- shared-path preprocessing;
- browser WASM path initialization;
- long-lived `createRoutingSession()` transactions for component dragging;
- conversion of libavoid route results into editor-core `RouteResult` objects;
- applying external routes as one editor history transaction.

No WASM binary is copied into editor-core. The host application owns optional package installation and asset deployment.

## Large-scene browser benchmark

`browser-benchmark/` contains a static ES-module benchmark that generates and tests:

- 1,000 components;
- 10,000 components;
- 50,000 components.

It records:

- document generation;
- scene + adaptive spatial-index construction;
- indexed hit-test throughput;
- viewport render-plan cost;
- visible Canvas2D render time.

Auto-routing, validation and crossing detection are disabled in this benchmark so large-canvas runtime costs are isolated. A sparse wire population remains enabled to exercise mixed-size indexing.

## Python implementation

`python/editor_core_py/` is a dependency-free Python implementation of the same architecture:

- dataclass document model;
- component/port geometry;
- incremental connectivity;
- uniform and adaptive multi-resolution spatial indexing;
- orthogonal visibility/A* routing;
- scene runtime with dependency-driven rerouting;
- indexed hit testing and viewport render planning;
- transaction engine with authoritative impacts and undo/redo;
- routing obstacle/topology/environment revisions;
- dependency-free layered layout;
- injected native/SWIG libavoid backend seam.

The Python package also includes an optional Node bridge. When `elkjs` and `@mr_mint/elkjs-libavoid` are installed in `python/node_bridge`, Python can call the same production ELK and libavoid-WASM backends while keeping its core Python package dependency-free.

## Recommended repository structure

The upstream repository still exposes generated JavaScript/declaration artifacts as its primary files. A future source-normalization phase should restore the TypeScript `src/` tree and generate `.js`, `.d.ts`, and source maps in CI. The v3 package avoids rewriting generated base files by layering the production engine subclass at the package export boundary.
