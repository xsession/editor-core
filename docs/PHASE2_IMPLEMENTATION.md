# editor-core Phase 2 Integration Notes

## New modules

| File | Purpose |
|---|---|
| `advanced-visual.js` | scene index, culling, LOD, render plan, ELK/libavoid data adapters |
| `routing-accelerator.js` | local obstacle/route indices, accelerated routing, indexed crossing detection, async stale-result guard |
| `connection-intelligence.js` | magnetic port targeting, compatibility ranking, hysteresis, preview routing |
| `incremental-runtime.js` | incremental geometry/routing/label/index update coordinator |
| `canvas2d.js` | culled Canvas2D renderer with cached `Path2D` wire geometry |
| `pixi8.js` | optional injected PixiJS 8 renderer |
| `bundle-routing.js` | stable harness/bus lane routing and generated corridor constraints |
| `connector-paths.js` | polyline/rounded/smooth/jump-over connector rendering strategies |
| `performance.js` | bounded phase profiler and frame-budget helper |

## Recommended host integration

```js
import {
  IncrementalSceneRuntime,
  MagneticConnectionSession,
  Canvas2DRenderer,
  EditorPerformanceMonitor,
} from './editor-core/index.js'

const runtime = new IncrementalSceneRuntime({
  validate: true,
  findCrossings: true,
})

runtime.reset(document)

// After an editor-core command returns MutationImpact:
runtime.update(nextDocument, impact)

const plan = runtime.renderPlan({
  viewport: worldViewport,
  zoom,
  selection,
  cameraMoving: isPanningOrZooming,
})

renderer.render(plan, canvas, { scale: zoom })
```

During panning/zooming, `cameraMoving: true` forces low LOD so hover/label/port detail does not dominate the frame. When the camera settles, rebuild the plan at the normal LOD.

## Connection gesture integration

```js
const session = new MagneticConnectionSession(sourceEndpoint, {
  snapRadiusPx: 18,
  releaseRadiusPx: 28,
  wireKind: 'discrete',
})

const result = session.update(pointerWorld, document, {
  zoom,
  componentGeometries: runtime.scene.componentGeometries,
}, runtime.spatialIndex)

// result.snappedPoint drives the preview endpoint.
// result.candidate contains validity/reason/electrical/facing information.
```

## Routing backend strategy

Use the built-in router for pointer-rate previews and normal edits. Use a worker/WASM backend only for expensive post-processing. `AsyncRoutingCoordinator` discards stale responses if a wire has changed again before a worker result arrives.

Recommended priority:

1. built-in accelerated router;
2. bundle lane constraints for harnesses;
3. ELK only for explicit auto-layout operations;
4. libavoid/WASM for optional dense-connector quality passes.

## Important repository cleanup still recommended

The upstream repository currently contains generated `.js`, `.d.ts` and source-map artifacts without the original TypeScript source tree or package/build metadata. Before treating these changes as the long-term production implementation, restore the original `src/` tree and make generated output reproducible in CI. Otherwise runtime JS, declarations and source maps can silently diverge.

## Validation included in the patch bundle

- JavaScript syntax checked with Node 22 for every added/modified `.js` and benchmark `.mjs` file.
- `performance.js` received an executable smoke test.
- `spatial-benchmark.mjs` was corrected to report its index-build timing.
- `crossing-benchmark.mjs` was added to compare indexed crossing detection against the original pairwise implementation once the patch is applied over the full repository.

The full runtime benchmarks require the original `editor-core` dependency files to be present beside the patch modules.
