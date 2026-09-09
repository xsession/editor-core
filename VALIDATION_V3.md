# v3 validation

## JavaScript

- `node --check` passes for every JavaScript module in `editor-core/`.
- `node --check` passes for the browser benchmark modules and Python Node bridge.
- TypeScript 5.8 declaration parsing passes for:
  - `performance-engine.d.ts`
  - `elk-layout.d.ts`
  - `libavoid-backend.d.ts`
- A reconstructed integration harness passes for:
  - package-default optimized engine subclass;
  - authoritative removal detection;
  - obstacle revision increment;
  - dependency-discovered wire reroute;
  - undo restoration;
  - ELK layout transaction with mocked ELK implementation;
  - real libavoid adapter contract with mocked current package API.

Result: `v3 JS integration self-test passed`.

## Python

`pytest -q` result: **3 passed**.

Covered:

- incremental component move reroutes attached wire;
- route changes are undoable;
- routing obstacle revision increments;
- connectivity index exposes connected wires;
- adaptive spatial index returns both small and promoted large objects.

Additional Node-bridge graph conversion test passes.

## Python large-scene benchmark

Environment snapshot from this run:

| Components | Scene/index build | Indexed queries | Viewport plan | Visible components |
|---:|---:|---:|---:|---:|
| 1,000 | 90.03 ms | 5,000 in 33.28 ms | 0.47 ms | 121 |
| 10,000 | 850.21 ms | 5,000 in 47.77 ms | 0.79 ms | 121 |
| 50,000 | 5,588.54 ms | 2,000 in 24.59 ms | 0.84 ms | 121 |

The benchmark has no wire routing enabled and is intended to isolate component geometry + adaptive spatial indexing + viewport query behavior. Results are environment-specific and should be rerun on the target workstation.

## Browser benchmark limitation

A real graphical browser is not available in this execution environment, so the browser benchmark application was syntax-validated but not executed here. It is included ready to serve from the repository root.
