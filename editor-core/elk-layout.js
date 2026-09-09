import { createElkGraph, routesFromElkResult } from './advanced-visual.js';
import { createWaypointConstraint } from './routing.js';

function resolveElkConstructor(module) {
    const candidate = module?.default ?? module?.ELK ?? module;
    if (typeof candidate !== 'function')
        throw new Error('elkjs module did not expose an ELK constructor.');
    return candidate;
}

/** Optional elkjs backend. No hard dependency is introduced into editor-core. */
export class ElkLayoutBackend {
    constructor(options = {}) {
        this.options = options;
        this.elk = options.elk;
        this.importer = options.importer ?? (() => import('elkjs'));
    }

    async init() {
        if (this.elk)
            return this.elk;
        const module = await this.importer();
        const ELK = resolveElkConstructor(module);
        this.elk = new ELK(this.options.constructorOptions);
        return this.elk;
    }

    async layoutScene(scene, options = {}) {
        const elk = await this.init();
        const graph = createElkGraph(scene, { ...this.options.graph, ...options });
        return elk.layout(graph, options.layoutCallOptions);
    }

    async route(request, options = {}) {
        const scene = request?.scene ?? request;
        const result = await this.layoutScene(scene, options);
        return { result, routes: routesFromElkResult(result) };
    }

    get capabilities() {
        return { layout: true, globalRouting: true, ports: true, hierarchical: true, workerFriendly: true };
    }
}

function resultNodeMap(result) {
    return new Map((result?.children ?? []).map((node) => [node.id, node]));
}

/**
 * Applies ELK layout as one editor history transaction. Components are moved by
 * body-center, so editor-core's center-based ComponentNode.position remains
 * correct. ELK routes can optionally be converted to locked/manual waypoints.
 */
export async function applyElkLayoutTransaction(engine, backend = new ElkLayoutBackend(), options = {}) {
    const scene = engine.scene;
    if (!scene)
        throw new Error('The engine has no derived scene.');
    const result = await backend.layoutScene(scene, options);
    const nodes = resultNodeMap(result);
    const routes = routesFromElkResult(result);
    const applyRoutes = options.applyRoutes ?? false;

    const impact = engine.execute(options.label ?? 'Auto-layout with ELK', (draft, mutationImpact) => {
        for (const componentId of draft.componentOrder) {
            const component = draft.components[componentId];
            const oldGeometry = scene.componentGeometries[componentId];
            const node = nodes.get(componentId);
            if (!component || !oldGeometry || !node)
                continue;
            const width = node.width ?? oldGeometry.worldBody.width;
            const height = node.height ?? oldGeometry.worldBody.height;
            component.position = {
                x: (node.x ?? oldGeometry.worldBody.x) + width / 2,
                y: (node.y ?? oldGeometry.worldBody.y) + height / 2,
            };
            mutationImpact.changedComponents.push(componentId);
        }
        if (applyRoutes) {
            for (const [wireId, points] of routes) {
                const wire = draft.wires[wireId];
                if (!wire || points.length < 2)
                    continue;
                wire.routing.pattern = 'manual';
                wire.routing.constraints = points.slice(1, -1).map((point, index) =>
                    createWaypointConstraint(`${wireId}:elk:${index + 1}`, point, true));
                mutationImpact.reroutedWires.push(wireId);
            }
        }
    });

    return { result, routes, impact };
}

export function createElkBackend(options) {
    return new ElkLayoutBackend(options);
}
