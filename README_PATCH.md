# editor-core advanced visual/performance patch v2

Prepared against `xsession/editor-core` commit `95a26c1909325fb3135a62f34dbad55cbf0e8973`.

This bundle extends the first performance patch into a reusable high-performance visual runtime for engineering editors. It stays dependency-light and framework-neutral while adding optional Canvas2D/PixiJS rendering, advanced routing helpers, worker routing, incremental recomputation, and large-scene indexes.

## Files to add

### Runtime / scene
- `editor-core/advanced-visual.js` / `.d.ts`
- `editor-core/incremental-runtime.js` / `.d.ts`
- `editor-core/visual-runtime.js` / `.d.ts`
- `editor-core/connectivity-index.js` / `.d.ts`
- `editor-core/adaptive-spatial.js` / `.d.ts`
- `editor-core/render-runtime.js` / `.d.ts`
- `editor-core/performance.js` / `.d.ts`

### Routing / connecting
- `editor-core/routing-accelerator.js` / `.d.ts`
- `editor-core/routing-scheduler.js` / `.d.ts`
- `editor-core/worker-routing.js` / `.d.ts`
- `editor-core/connection-intelligence.js` / `.d.ts`
- `editor-core/bundle-routing.js` / `.d.ts`
- `editor-core/connector-paths.js` / `.d.ts`

### Rendering
- `editor-core/canvas2d.js` / `.d.ts`
- `editor-core/pixi8.js` / `.d.ts`

### Research, tests, benchmarks
- `docs/ADVANCED_VISUAL_ENGINE_RESEARCH.md`
- `docs/PERFORMANCE_ARCHITECTURE_V2.md`
- `benchmarks/spatial-benchmark.mjs`
- `benchmarks/adaptive-spatial-benchmark.mjs`
- `benchmarks/incremental-connectivity-benchmark.mjs`
- `tests/advanced-performance-selftest.mjs`

## Files to replace

- `editor-core/index.js`
- `editor-core/index.d.ts`

The v2 entry point also fixes an integration bug in the first bundle: the incremental runtime, routing accelerator, connection intelligence and performance modules are now exported by `index.js` / `index.d.ts`.

## Main capabilities

### 1. Indexed interactive operations
- component/port/label/wire/segment/waypoint broad phase
- indexed hit testing
- indexed marquee selection
- viewport culling
- selected-entity pinning

### 2. Multi-resolution spatial indexing
`AdaptiveSpatialIndex` keeps small geometry in fine grids and promotes very large/long geometry to coarser levels. Extremely large objects use an overflow set. This prevents long wires, large groups and imported backgrounds from exploding a fine uniform grid into excessive buckets.

### 3. Incremental scene derivation
- changed component geometry only
- locally affected wire rerouting
- partial label reflow
- owner-level spatial-index updates
- indexed crossing detection
- one-pass/full-build connectivity plus incremental connectivity maintenance

### 4. High-performance render pipeline
- backend-neutral render plans
- zoom-dependent LOD
- Canvas2D interactive renderer
- Path2D route cache
- dirty-region render diffing
- partial Canvas2D repaint clipping
- optional retained PixiJS v8 renderer

### 5. Advanced routing / connection UX
- spatially accelerated local routing
- deterministic full-context fallback
- indexed wire-crossing detection
- magnetic connection target scoring and hysteresis
- preview routing
- stable multi-wire/bus lane routing
- rounded/smooth/jump-over connector path registry
- ELK graph adapter
- libavoid/WASM request adapter

### 6. Scheduling / workers
- coalescing priority routing queue
- LRU route-result cache
- revision-aware asynchronous routing coordinator
- Worker routing protocol/client
- cancellation and superseding of stale jobs
- simple worker pool

### 7. Unified host API
`HighPerformanceVisualRuntime` combines:
- incremental scene runtime
- indexed hit/marquee interaction
- render planning
- dirty-region diffing
- Canvas2D backend by default
- pluggable renderer/router registry
- magnetic connection sessions
- runtime/performance metrics

## Validation completed

- `node --check` passes for every added/replaced JavaScript module.
- TypeScript declaration syntax passes using `tsc --noEmit --skipLibCheck --noResolve` for all patch `.d.ts` files.
- `tests/advanced-performance-selftest.mjs` passes in a dependency stub harness and covers:
  - 10,000-object adaptive indexing plus very large objects
  - incremental connectivity mutation
  - render-plan dirty-region diffing
  - routing task coalescing and cache hits
  - worker request/response routing protocol
  - bundle routing
  - jump-over connector generation
  - retained Pixi display-object reuse

## Synthetic benchmark snapshot from this environment

Run sizes were intentionally moderate to keep validation fast; use the included scripts on the target workstation for authoritative numbers.

- Mixed spatial data: 20,000 small + 20 large objects, 2,000 queries
  - uniform grid build: ~35.3 ms
  - adaptive grid build: ~24.1 ms
  - uniform queries: ~27.7 ms
  - adaptive queries: ~33.7 ms
  - semantic hit totals matched exactly
  - all 20 large objects were promoted from the fine grid to a 1024-unit level
- Connectivity: 20,000 wires, 3,000 endpoint updates
  - initial build: ~59.3 ms
  - incremental updates: ~16.5 ms total
  - ~5.5 microseconds/update average

The adaptive index is therefore a scale-safety strategy, not a claim that it beats a single uniform grid on every small local query. Its main benefit is bounded bucket fan-out and more predictable memory/build behavior for mixed-size engineering scenes.

## Recommended integration order

1. Apply this bundle to a feature branch.
2. Run the existing semantic tests against legacy and indexed hit/marquee results.
3. Switch host interaction to `HighPerformanceVisualRuntime`.
4. Use Canvas2D first; keep SVG for export/snapshots.
5. Enable PixiJS only for projects that exceed Canvas2D performance targets.
6. Move heavy routing to `RoutingWorkerClient` / `RoutingWorkerPool`.
7. Integrate ELK for explicit auto-layout and libavoid for dense object-avoiding connector reroutes.
8. Restore the missing TypeScript `src/` tree and make compiled JS/declarations generated artifacts rather than the primary editable source.
