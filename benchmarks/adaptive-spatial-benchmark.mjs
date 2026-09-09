import { performance } from 'node:perf_hooks';
import { UniformGridIndex } from '../editor-core/spatial.js';
import { AdaptiveSpatialIndex } from '../editor-core/adaptive-spatial.js';

const SMALL_ITEMS = Number(process.env.SMALL_ITEMS ?? 50000);
const LARGE_ITEMS = Number(process.env.LARGE_ITEMS ?? 40);
const QUERIES = Number(process.env.QUERIES ?? 5000);
const WORLD = 20000;

function makeItems() {
    const items = [];
    for (let i = 0; i < SMALL_ITEMS; i += 1) {
        const x = (i * 97) % WORLD;
        const y = (i * 193) % WORLD;
        items.push({ id: `small-${i}`, bounds: { x, y, width: 12, height: 12 }, value: i });
    }
    for (let i = 0; i < LARGE_ITEMS; i += 1) {
        const x = (i * 431) % (WORLD - 4000);
        const y = (i * 719) % (WORLD - 4000);
        items.push({ id: `large-${i}`, bounds: { x, y, width: 3000 + (i % 4) * 500, height: 1800 + (i % 5) * 400 }, value: `large-${i}` });
    }
    return items;
}

function build(index, items) {
    const start = performance.now();
    for (const item of items)
        index.insert(item);
    return performance.now() - start;
}

function query(index) {
    let hits = 0;
    const start = performance.now();
    for (let i = 0; i < QUERIES; i += 1) {
        const x = (i * 367) % WORLD;
        const y = (i * 911) % WORLD;
        hits += index.queryRect({ x, y, width: 160, height: 100 }).length;
    }
    return { ms: performance.now() - start, hits };
}

const items = makeItems();
const uniform = new UniformGridIndex(64);
const adaptive = new AdaptiveSpatialIndex({ cellSizes: [64, 256, 1024, 4096], maxCellsPerAxis: 8, maxCellsPerItem: 48 });

const uniformBuildMs = build(uniform, items);
const adaptiveBuildMs = build(adaptive, items);
const uniformQuery = query(uniform);
const adaptiveQuery = query(adaptive);

if (uniformQuery.hits !== adaptiveQuery.hits)
    throw new Error(`Query semantic mismatch: uniform=${uniformQuery.hits}, adaptive=${adaptiveQuery.hits}`);

console.log(JSON.stringify({
    smallItems: SMALL_ITEMS,
    largeItems: LARGE_ITEMS,
    queries: QUERIES,
    uniform: { buildMs: uniformBuildMs, queryMs: uniformQuery.ms, size: uniform.size },
    adaptive: { buildMs: adaptiveBuildMs, queryMs: adaptiveQuery.ms, size: adaptive.size, stats: adaptive.stats },
    hitCount: uniformQuery.hits,
}, null, 2));
