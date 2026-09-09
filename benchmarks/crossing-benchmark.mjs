import { performance } from 'node:perf_hooks';
import { findWireCrossings } from '../editor-core/routing.js';
import { findWireCrossingsIndexed } from '../editor-core/routing-accelerator.js';

const wireCount = Number(process.argv[2] ?? 3000);
const span = Math.ceil(Math.sqrt(wireCount)) * 20;
const wires = [];
for (let index = 0; index < wireCount; index += 1) {
    const horizontal = index % 2 === 0;
    const lane = (index * 37) % span;
    const points = horizontal
        ? [{ x: 0, y: lane }, { x: span, y: lane }]
        : [{ x: lane, y: 0 }, { x: lane, y: span }];
    wires.push({
        id: `w${index}`,
        hidden: false,
        style: { zIndex: index % 4 },
        route: { points },
    });
}

let t0 = performance.now();
const indexed = findWireCrossingsIndexed(wires, { cellSize: 128 });
let t1 = performance.now();
const indexedMs = t1 - t0;

let baselineMs;
let baselineCount;
if (wireCount <= 2000 || process.argv.includes('--baseline')) {
    t0 = performance.now();
    const baseline = findWireCrossings(wires);
    t1 = performance.now();
    baselineMs = t1 - t0;
    baselineCount = baseline.length;
}

console.log(JSON.stringify({
    wireCount,
    indexedCrossings: indexed.length,
    indexedMs: Number(indexedMs.toFixed(2)),
    baselineCrossings: baselineCount,
    baselineMs: baselineMs === undefined ? undefined : Number(baselineMs.toFixed(2)),
    speedup: baselineMs === undefined ? undefined : Number((baselineMs / indexedMs).toFixed(2)),
}, null, 2));
