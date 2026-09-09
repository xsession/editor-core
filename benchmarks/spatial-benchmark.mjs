import { performance } from 'node:perf_hooks';
import { SceneSpatialIndex } from '../editor-core/advanced-visual.js';

const componentCount = Number(process.argv[2] ?? 10000);
const wireCount = Number(process.argv[3] ?? 20000);
const columns = Math.ceil(Math.sqrt(componentCount));
const spacing = 80;

const document = {
    revision: 1,
    componentOrder: [],
    wireOrder: [],
    labelOrder: [],
    components: {},
    wires: {},
    labels: {},
};
const geometries = {};

for (let index = 0; index < componentCount; index += 1) {
    const id = `c${index}`;
    const x = (index % columns) * spacing;
    const y = Math.floor(index / columns) * spacing;
    document.componentOrder.push(id);
    document.components[id] = { id, hidden: false };
    geometries[id] = {
        componentId: id,
        worldBounds: { x, y, width: 56, height: 36 },
        worldBody: { x, y, width: 56, height: 36 },
        headerBounds: { x, y, width: 56, height: 12 },
        ports: {
            p0: { portId: 'p0', center: { x, y: y + 18 }, hitBounds: { x: x - 6, y: y + 12, width: 12, height: 12 } },
            p1: { portId: 'p1', center: { x: x + 56, y: y + 18 }, hitBounds: { x: x + 50, y: y + 12, width: 12, height: 12 } },
        },
    };
}

for (let index = 0; index < wireCount; index += 1) {
    const id = `w${index}`;
    const from = index % componentCount;
    const to = (index * 17 + 97) % componentCount;
    const a = geometries[`c${from}`].ports.p1.center;
    const b = geometries[`c${to}`].ports.p0.center;
    const midX = (a.x + b.x) / 2;
    document.wireOrder.push(id);
    document.wires[id] = {
        id,
        hidden: false,
        style: { width: 2, zIndex: 0 },
        route: { points: [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b] },
    };
}

const index = new SceneSpatialIndex(128);
let t0 = performance.now();
index.rebuild(document, geometries, []);
let t1 = performance.now();
const buildMs = t1 - t0;

let candidateTotal = 0;
const queryCount = 5000;
t0 = performance.now();
for (let query = 0; query < queryCount; query += 1) {
    const x = ((query * 2654435761) % (columns * spacing));
    const y = ((query * 2246822519) % (columns * spacing));
    candidateTotal += index.queryPoint({ x, y }, 8).length;
}
t1 = performance.now();

console.log(JSON.stringify({
    componentCount,
    wireCount,
    indexedItems: index.size,
    indexStats: index.stats,
    buildMs: Number(buildMs.toFixed(2)),
    queryCount,
    averageCandidates: candidateTotal / queryCount,
    queryMs: Number((t1 - t0).toFixed(2)),
}, null, 2));
