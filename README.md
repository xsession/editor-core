# editor-core advanced visual/performance v3

Prepared on top of the v2 patch for `xsession/editor-core` commit `95a26c1909325fb3135a62f34dbad55cbf0e8973`.

## New in v3

- package-default incremental `HarnessEditorEngine`;
- original engine retained as `LegacyHarnessEditorEngine`;
- authoritative mutation-impact derivation;
- obstacle/topology/environment routing revision counters;
- dependency-driven local rerouting wired into command/preview/undo/redo flows;
- ELK auto-layout backend + one-history-entry layout transaction;
- actual optional libavoid WebAssembly backend using `@mr_mint/elkjs-libavoid`;
- persistent libavoid routing sessions for drag transactions;
- 1k / 10k / 50k browser large-scene benchmark app;
- dependency-free Python implementation;
- optional Python-to-Node bridge for the same ELK/libavoid production backends.

## Apply JavaScript patch

Copy the contents of this package over a checkout of `xsession/editor-core` at the referenced commit. The `editor-core/index.js` / `index.d.ts` files expose the optimized engine as the normal `HarnessEditorEngine` name.

Optional external routing/layout dependencies:

```bash
npm install elkjs @mr_mint/elkjs-libavoid
```

Browser libavoid requires serving `libavoid.wasm` and passing its URL to `LibavoidWasmBackend.init()` / constructor options.

## Python

See `python/README.md`.

## Validation

See `VALIDATION_V3.md`.
