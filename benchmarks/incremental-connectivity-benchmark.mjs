import { performance } from 'node:perf_hooks';
import { MutableConnectivityIndex } from '../editor-core/connectivity-index.js';

const WIRES = Number(process.env.WIRES ?? 50000);
const UPDATES = Number(process.env.UPDATES ?? 5000);
const COMPONENTS = 10000;

function port(component, pin) {
    return { kind: 'port', componentId: `c${component}`, portId: `p${pin}` };
}

const document = { wireOrder: [], wires: {} };
for (let i = 0; i < WIRES; i += 1) {
    const id = `w${i}`;
    document.wireOrder.push(id);
    document.wires[id] = {
        id,
        source: port(i % COMPONENTS, i % 16),
        target: port((i * 13 + 7) % COMPONENTS, (i * 5 + 3) % 16),
    };
}

let start = performance.now();
const index = new MutableConnectivityIndex(document);
const buildMs = performance.now() - start;

start = performance.now();
for (let i = 0; i < UPDATES; i += 1) {
    const id = `w${(i * 47) % WIRES}`;
    const wire = document.wires[id];
    wire.target = port((i * 37 + 11) % COMPONENTS, i % 16);
    index.upsertWire(wire);
}
const updateMs = performance.now() - start;

console.log(JSON.stringify({
    wires: WIRES,
    updates: UPDATES,
    buildMs,
    updateMs,
    averageUpdateUs: updateMs * 1000 / UPDATES,
    stats: index.stats,
}, null, 2));
