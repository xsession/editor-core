# Browser large-scene benchmark

Serve the repository root with any static HTTP server and open `browser-benchmark/`.

The benchmark executes three scenarios: 1,000, 10,000 and 50,000 components. It intentionally disables automatic routing, crossing detection and validation so the measurement focuses on the visual runtime/index hot path. Sparse wires are still generated so mixed-size spatial indexing is exercised.

Recommended additional CI/browser measurements:

- Chrome and Firefox latest, desktop;
- 1k full routing benchmark;
- 10k drag-preview benchmark with 10 connected wires;
- 50k pan/zoom frame-time trace;
- Canvas2D vs PixiJS adapter comparison using the same render plan.
