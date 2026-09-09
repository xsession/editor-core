# `@xsession/editor-core`

A framework-neutral engineering-diagram engine with first-class wiring-harness
semantics. The repository owns the reusable editor model, geometry, routing,
interaction, rendering, validation, serialization, performance runtimes, and
semantic tests used by RouteCore and other hosts.

## Core capabilities

- dynamic components, stable ports, four-sided pin banks, rotation, mirroring,
  measured labels, and connected-port mutation policies;
- direct, orthogonal, dogleg, trunk, manual, and fan-out routing with lead-ins,
  obstacle avoidance, rounded bends, route constraints, and crossings;
- solid, striped, tracer, dual-color, shield, and layered wire paint;
- automatic, owner-relative, and world-pinned label placement;
- preview transactions, undo/redo, hit testing, CAD marquee selection, snapping,
  connection gestures, and segment manipulation;
- deterministic SVG, Canvas2D, and optional PixiJS render paths;
- adaptive spatial and connectivity indexes, incremental scene derivation,
  dependency-scoped rerouting, dirty-region rendering, LOD, and metrics;
- routing schedulers, workers, caches, magnetic targets, bundle routing, ELK
  layout, and optional libavoid/WASM routing;
- deterministic serialization, validation, and 1k/10k/50k benchmarks;
- JavaScript/TypeScript and dependency-free Python implementations.

The TypeScript source of record is in `src/`. Compiled ESM and declarations are
in `editor-core/`. Advanced runtime modules without TypeScript implementations
retain checked declarations in `src/` and checked JavaScript in `editor-core/`.

## Build and test

TypeScript 5.8 or newer is required to rebuild the typed base:

```bash
npm run build
npm test
```

The base semantic suite verifies component geometry, routing, rendering,
interaction, labels, serialization, viewports, snapping, and spatial behavior.
The advanced self-test verifies adaptive indexing, incremental connectivity,
render diffs, task coalescing, worker routing, bundles, connector paths, and
retained Pixi object reuse.

## Entry point

```js
import {
  HarnessEditorEngine,
  LegacyHarnessEditorEngine,
  HighPerformanceVisualRuntime,
  AdaptiveSpatialIndex,
  createEmptyDocument,
  renderEditorSvg,
} from '@xsession/editor-core';
```

`HarnessEditorEngine` is the incremental production engine.
`LegacyHarnessEditorEngine` remains available for comparison and compatibility.

Optional ELK/libavoid integrations require their corresponding external
packages. The default SVG and Canvas2D paths remain dependency-free.

See [API.md](docs/API.md), [HOST_INTEGRATION.md](docs/HOST_INTEGRATION.md), and
[ROUTECORE_CAPABILITY_REVIEW.md](docs/ROUTECORE_CAPABILITY_REVIEW.md).
