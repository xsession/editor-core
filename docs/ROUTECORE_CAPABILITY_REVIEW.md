# RouteCore capability review and core boundary

**Reviewed:** 2026-09-09

**RouteCore source reviewed:** `packages/harness-editor-core`

**Editor-core baseline:** `d6d0abb`

## Result

The RouteCore package and editor-core baseline shared the same base engine:
20 of 25 compiled base JavaScript modules were byte-identical. The remaining
differences were product names, theme IDs, SVG namespaces, sample branding, and
the entry point. Editor-core already added a substantial performance/runtime
layer over that base.

The authoritative boundary is now:

| Concern | Owner |
|---|---|
| Document types and invariants | editor-core |
| Geometry, components, ports, pin banks | editor-core |
| Routing, constraints, crossings, bundles | editor-core |
| Labels, paint, SVG/Canvas/Pixi rendering | editor-core |
| Interaction, selection, snapping, history | editor-core |
| Validation and deterministic serialization | editor-core |
| Spatial/connectivity indexes and incremental runtime | editor-core |
| Workers, scheduling, ELK/libavoid adapters, benchmarks | editor-core |
| Product shell, menus, docks, creators, workflows | RouteCore |
| SQLite schema, storage, revisions, BOM persistence | RouteCore |
| Local HTTP host and export orchestration | RouteCore |
| Product branding, project samples, release packaging | RouteCore |

## Capabilities promoted from RouteCore

- Full TypeScript source for the base editor, not only generated JavaScript.
- Typed geometry modules for vectors, rectangles, transforms, and polylines.
- Dynamic component construction and collision-safe mixed-side pin layouts.
- Stable port identities and prevent/detach/remap connected-pin policies.
- Deterministic routing patterns, obstacle avoidance, lead-ins, lane separation,
  bend-radius clamping, constraints, crossings, and route editing.
- Wire appearance layers and background-aware label contrast.
- Automatic/manual label placement and collision scoring.
- Stateful engine, transactions, history, typed events, and direct interaction.
- SVG accessibility metadata and deterministic serialization.
- 63 semantic tests and the public API/host integration documentation.

## Capabilities retained and exposed from editor-core

- Production `HarnessEditorEngine` backed by incremental scene derivation.
- `LegacyHarnessEditorEngine` for behavioral comparison.
- Adaptive multi-resolution spatial indexing and mutable connectivity indexes.
- Mutation impact derivation and routing obstacle/topology/environment revisions.
- Dependency-scoped rerouting and label reflow.
- Dirty-region render planning, LOD, Canvas2D, and optional PixiJS.
- Route scheduling, LRU caching, workers, magnetic connection intelligence,
  bundle routing, connector paths, ELK layout, and libavoid/WASM integration.
- Large-scene benchmarks and Python parity implementation.

## Integration contract

RouteCore never compiles a second editor implementation. Its build validates the
submodule and copies `editor-core/` to both the compatibility package `dist/`
and the browser vendor directory. Server modules and browser TypeScript consume
that synchronized runtime. A missing or incomplete submodule fails the build
with an initialization command instead of silently falling back to stale code.

Product samples may customize generic sample documents after creation. Product
CSS, storage schema names, interchange formats, and application workflows remain
outside editor-core.
