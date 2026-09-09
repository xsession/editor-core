# Validation report

Base repository commit: `95a26c1909325fb3135a62f34dbad55cbf0e8973`

## Static checks

- Every `editor-core/*.js` file passes `node --check`.
- Every patch declaration file passes TypeScript declaration parsing with:

```sh
tsc --noEmit --skipLibCheck --noResolve --module NodeNext --moduleResolution NodeNext *.d.ts
```

- All new re-exports in `editor-core/index.js` resolve either to a patch module or to a module present in the base repository.

## Functional self-test

`tests/advanced-performance-selftest.mjs` covers:

- adaptive multi-resolution spatial indexing;
- very large-object overflow behavior;
- incremental connectivity mutation;
- render-plan dirty-region generation;
- routing task coalescing;
- LRU routing cache reuse;
- worker routing request/response protocol;
- stable wire bundle routing;
- jump-over connector path generation;
- retained PixiJS object reuse.

Result in the local validation harness:

```text
advanced-performance-selftest: ok
```

## Synthetic benchmark snapshot

### Adaptive spatial benchmark

Parameters used for the validation run:

```text
small items: 20,000
large items: 20
queries: 2,000
```

Observed:

```text
uniform build:   ~35.3 ms
adaptive build:  ~24.1 ms
uniform queries: ~27.7 ms
adaptive queries:~33.7 ms
```

The hit counts matched exactly. All 20 large items were promoted out of the fine 64-unit level and stored at the 1024-unit level.

This benchmark demonstrates the intended tradeoff: the adaptive index bounds bucket fan-out and improves mixed-size build/memory behavior, while a simple uniform grid may remain slightly cheaper for small local queries.

### Incremental connectivity benchmark

Parameters:

```text
wires:   20,000
updates: 3,000
```

Observed:

```text
initial build:       ~59.3 ms
3,000 updates:       ~16.5 ms
average update cost: ~5.5 microseconds
```

These are synthetic regression numbers from this execution environment, not portable hardware guarantees.
