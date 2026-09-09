import assert from 'node:assert/strict';
import { AdaptiveSpatialIndex } from '../editor-core/adaptive-spatial.js';
import { MutableConnectivityIndex } from '../editor-core/connectivity-index.js';
import { RenderPlanDiffer } from '../editor-core/render-runtime.js';
import { RouteResultCache, RoutingTaskScheduler } from '../editor-core/routing-scheduler.js';
import { RoutingWorkerClient, installRoutingWorkerHandler } from '../editor-core/worker-routing.js';
import { routeWireBundle } from '../editor-core/bundle-routing.js';
import { jumpOverConnectorPath } from '../editor-core/connector-paths.js';
import { Pixi8Renderer } from '../editor-core/pixi8.js';

const spatial = new AdaptiveSpatialIndex({ cellSizes: [32, 128, 512], maxCellsPerItem: 16, maxCellsPerAxis: 4 });
for (let index = 0; index < 10_000; index += 1) {
    spatial.insert({
        id: `node-${index}`,
        bounds: { x: (index % 100) * 20, y: Math.floor(index / 100) * 20, width: 8, height: 8 },
        value: index,
    });
}
spatial.insert({ id: 'huge', bounds: { x: -10_000, y: -10_000, width: 30_000, height: 30_000 }, value: 'huge' });
assert.equal(spatial.size, 10_001);
assert.ok(spatial.stats.overflow >= 1);
assert.ok(spatial.queryPoint({ x: 5, y: 5 }, 2).some((item) => item.id === 'node-0'));

const document = {
    wireOrder: ['w1', 'w2'],
    wires: {
        w1: { id: 'w1', source: { kind: 'port', componentId: 'A', portId: '1' }, target: { kind: 'port', componentId: 'B', portId: '2' } },
        w2: { id: 'w2', source: { kind: 'port', componentId: 'A', portId: '1' }, target: { kind: 'port', componentId: 'C', portId: '3' } },
    },
};
const connectivity = new MutableConnectivityIndex(document);
assert.equal(connectivity.wiresForPort('A', '1').size, 2);
document.wires.w1 = { ...document.wires.w1, target: { kind: 'port', componentId: 'D', portId: '4' } };
connectivity.applyDocumentWires(document, ['w1']);
assert.equal(connectivity.wiresForComponent('B').size, 0);
assert.equal(connectivity.wiresForComponent('D').size, 1);

const basePlan = {
    revision: 1,
    lod: 'full',
    zoom: 1,
    viewport: { x: 0, y: 0, width: 1000, height: 1000 },
    components: [{ id: 'c', body: { x: 10, y: 10, width: 20, height: 20 }, header: { x: 10, y: 10, width: 20, height: 5 }, title: 'C', ports: [] }],
    wires: [],
    labels: [],
};
const nextPlan = structuredClone(basePlan);
nextPlan.revision += 1;
nextPlan.components[0].body.x = 30;
nextPlan.components[0].header.x = 30;
const diff = new RenderPlanDiffer().diff(basePlan, nextPlan);
assert.equal(diff.fullRedraw, false);
assert.ok(diff.changedOwners.has('component:c'));
assert.ok(diff.dirtyRegions.length > 0);

const cache = new RouteResultCache(4);
let routeCalls = 0;
const scheduler = new RoutingTaskScheduler({
    frameBudgetMs: 100,
    maxTasksPerDrain: 20,
    cache,
    route: async (value) => {
        routeCalls += 1;
        return value * 2;
    },
});
scheduler.schedule({ key: 'wire', request: 1, priority: 1, cacheKeyValue: 'a' });
scheduler.schedule({ key: 'wire', request: 2, priority: 2, cacheKeyValue: 'b' });
scheduler.schedule({ key: 'wire', request: 3, priority: 3, cacheKeyValue: 'c' });
let drained = await scheduler.drain();
assert.equal(drained.results.length, 1);
assert.equal(drained.results[0].result, 6);
assert.equal(scheduler.metrics.coalesced, 2);
scheduler.schedule({ key: 'cached', request: 5, cacheKeyValue: 'same' });
await scheduler.drain();
scheduler.schedule({ key: 'cached', request: 99, cacheKeyValue: 'same' });
drained = await scheduler.drain();
assert.equal(drained.results[0].result, 10);
assert.equal(scheduler.metrics.cacheHits, 1);
assert.equal(routeCalls, 2);

class Endpoint {
    constructor() { this.listeners = []; }
    connect(other) { this.other = other; }
    postMessage(data) { queueMicrotask(() => this.other.listeners.forEach((listener) => listener({ data }))); }
    addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
    removeEventListener(type, listener) { if (type === 'message') this.listeners = this.listeners.filter((item) => item !== listener); }
}
const clientEndpoint = new Endpoint();
const serverEndpoint = new Endpoint();
clientEndpoint.connect(serverEndpoint);
serverEndpoint.connect(clientEndpoint);
const uninstall = installRoutingWorkerHandler(serverEndpoint, async (payload) => ({ value: payload.value * 3 }));
const workerClient = new RoutingWorkerClient(clientEndpoint);
const workerResult = await workerClient.route({ wireId: 'worker-wire', value: 7 }, { key: 'worker-wire', revision: 9 });
assert.equal(workerResult.stale, false);
assert.equal(workerResult.result.value, 21);
workerClient.destroy();
uninstall();

const bundle = routeWireBundle([
    { id: 'a', source: { x: 0, y: 0 }, target: { x: 100, y: 30 } },
    { id: 'b', source: { x: 0, y: 20 }, target: { x: 100, y: 10 } },
], { orientation: 'horizontal', laneSpacing: 10 });
assert.equal(bundle.routes.size, 2);
assert.equal(bundle.lanes.size, 2);
assert.ok(jumpOverConnectorPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ overWire: 'w', point: { x: 50, y: 0 } }], 'w', 5).includes(' A '));

class FakeContainer {
    constructor() {
        this.children = [];
        this.parent = null;
        this.scale = { set() {} };
        this.position = { set() {} };
    }
    addChild(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    destroy() {}
}
class FakeGraphics extends FakeContainer {
    clear() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    stroke() { return this; }
    roundRect() { return this; }
    fill() { return this; }
    circle() { return this; }
}
class FakeText extends FakeContainer {
    constructor(options) {
        super();
        this.text = options.text;
        this.style = options.style;
        this.anchor = { set() {} };
    }
}
const pixi = new Pixi8Renderer({ Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText });
const stage = new FakeContainer();
const pixiPlan = {
    zoom: 1,
    lod: 'full',
    viewport: { x: 0, y: 0, width: 100, height: 100 },
    wires: [{ id: 'w', routeRevision: 1, status: 'valid', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], style: { width: 2 } }],
    components: [{ id: 'c', body: { x: 1, y: 1, width: 10, height: 10 }, header: { x: 1, y: 1, width: 10, height: 3 }, ports: [], title: 'C' }],
    labels: [],
};
pixi.render(pixiPlan, stage);
const updated = pixi.metrics.updated;
pixi.render(pixiPlan, stage);
assert.equal(pixi.metrics.updated, updated);
pixi.destroy();

console.log('advanced-performance-selftest: ok');
