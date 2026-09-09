# editor-core Python

A dependency-free Python implementation of the same high-performance engineering-editor architecture used by the JavaScript v3 patch.

Included:

- dataclass document/component/port/wire model;
- center-based component geometry and port placement;
- uniform and adaptive multi-resolution spatial indexes;
- incremental connectivity index;
- deterministic orthogonal visibility/A* router;
- incremental scene runtime and indexed hit testing;
- mutation-authoritative `HarnessEditorEngine` with undo/redo;
- routing obstacle/topology/environment revision counters;
- dependency-driven wire rerouting after component moves;
- dependency-free layered auto-layout;
- optional injection seam for native/SWIG libavoid bindings;
- pytest-style functional tests and 1k/10k/50k benchmark.

## Run tests

```bash
cd python
python -m pytest -q
```

## Run benchmark

```bash
cd python
PYTHONPATH=. python benchmarks/large_scene.py
```

## Optional ELK / libavoid backends

The Python core itself has no required third-party dependencies. To call the same JavaScript production backends from Python:

```bash
cd python/node_bridge
npm install
```

Then use `ElkJsBackend` or `LibavoidNodeBackend`. Browser-only WASM URL handling is not needed for the Python Node bridge; Node can resolve the package's WASM asset automatically through the backend package.
