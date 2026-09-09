import { computeSafeCornerRadii, polylineLength, routeSegments } from './geometry.js';
import { createWaypointConstraint } from './routing.js';

function uniquePoints(points) {
    const result = [];
    for (const point of points.filter(Boolean)) {
        const previous = result[result.length - 1];
        if (!previous || previous.x !== point.x || previous.y !== point.y)
            result.push({ x: point.x, y: point.y });
    }
    return result;
}

function componentBody(scene, componentId) {
    return scene.componentGeometries?.[componentId]?.worldBody;
}

/** Build the positioned ELK JSON form expected by @mr_mint/elkjs-libavoid. */
export function createLibavoidElkGraph(scene) {
    const children = [];
    for (const componentId of scene.document.componentOrder) {
        const component = scene.document.components[componentId];
        const geometry = scene.componentGeometries[componentId];
        if (!component || !geometry || component.hidden)
            continue;
        const body = geometry.worldBody;
        children.push({
            id: componentId,
            x: body.x,
            y: body.y,
            width: body.width,
            height: body.height,
            ports: Object.values(geometry.ports).map((port) => ({
                id: `${componentId}:${port.portId}`,
                x: port.center.x - body.x,
                y: port.center.y - body.y,
                width: 1,
                height: 1,
            })),
        });
    }
    const edges = [];
    for (const wireId of scene.document.wireOrder) {
        const wire = scene.document.wires[wireId];
        if (!wire || wire.hidden || wire.source.kind !== 'port' || wire.target.kind !== 'port')
            continue;
        edges.push({
            id: wireId,
            source: wire.source.componentId,
            target: wire.target.componentId,
            sourcePort: `${wire.source.componentId}:${wire.source.portId}`,
            targetPort: `${wire.target.componentId}:${wire.target.portId}`,
        });
    }
    return { id: scene.document.id ?? 'editor-core', children, edges };
}

export function libavoidRouteToEditorRoute(route, revision, requestedRadius = 0) {
    const points = uniquePoints([route?.sourcePoint, ...(route?.bendPoints ?? []), route?.targetPoint]);
    const segments = routeSegments(points);
    return {
        points,
        segments,
        cornerRadii: requestedRadius > 0 ? computeSafeCornerRadii(points, requestedRadius) : points.map(() => 0),
        length: polylineLength(points),
        bends: Math.max(0, points.length - 2),
        crossings: 0,
        obstacleViolations: [],
        status: points.length >= 2 ? 'valid' : 'invalid',
        diagnostics: ['Routed by libavoid WebAssembly.'],
        generatedAtRevision: revision,
    };
}

/**
 * Real optional WASM backend using @mr_mint/elkjs-libavoid, which in turn uses
 * libavoid-js/libavoid.wasm. Browser callers should pass wasmPath to init().
 */
export class LibavoidWasmBackend {
    constructor(options = {}) {
        this.options = options;
        this.importer = options.importer ?? (() => import('@mr_mint/elkjs-libavoid'));
        this.module = options.module;
        this.initialized = false;
    }

    async init(wasmPath = this.options.wasmPath) {
        if (!this.module)
            this.module = await this.importer();
        if (!this.initialized) {
            await this.module.init?.(wasmPath);
            this.initialized = true;
        }
        return this.module;
    }

    async routeScene(scene, options = {}) {
        const module = await this.init(options.wasmPath);
        const graph = createLibavoidElkGraph(scene);
        const raw = await module.routeEdges(graph, {
            routingType: options.routingType ?? 'orthogonal',
            shapeBufferDistance: options.shapeBufferDistance ?? options.clearance ?? 8,
            segmentPenalty: options.segmentPenalty ?? 10,
            crossingPenalty: options.crossingPenalty ?? 100,
            reverseDirectionPenalty: options.reverseDirectionPenalty ?? 18,
            portDirectionPenalty: options.portDirectionPenalty ?? 100,
            idealNudgingDistance: options.idealNudgingDistance ?? 6,
            nudgeOrthogonalSegmentsConnectedToShapes: options.nudgeOrthogonalSegmentsConnectedToShapes ?? true,
            nudgeOrthogonalTouchingColinearSegments: options.nudgeOrthogonalTouchingColinearSegments ?? true,
            performUnifyingNudgingPreprocessingStep: options.performUnifyingNudgingPreprocessingStep ?? true,
            nudgeSharedPathsWithCommonEndPoint: options.nudgeSharedPathsWithCommonEndPoint ?? true,
            edgeIds: options.edgeIds,
            selfLoopHandling: options.selfLoopHandling ?? 'fallback',
        });
        const routes = new Map();
        for (const [wireId, route] of raw) {
            const requestedRadius = scene.document.wires[wireId]?.routing?.requestedRadius ?? 0;
            routes.set(wireId, libavoidRouteToEditorRoute(route, scene.document.revision, requestedRadius));
        }
        return { graph, raw, routes };
    }

    async createSession(scene, options = {}) {
        const module = await this.init(options.wasmPath);
        const graph = createLibavoidElkGraph(scene);
        const session = await module.createRoutingSession(graph, {
            routingType: options.routingType ?? 'orthogonal',
            shapeBufferDistance: options.shapeBufferDistance ?? options.clearance ?? 8,
            segmentPenalty: options.segmentPenalty ?? 10,
            crossingPenalty: options.crossingPenalty ?? 100,
            portDirectionPenalty: options.portDirectionPenalty ?? 100,
            idealNudgingDistance: options.idealNudgingDistance ?? 6,
            nudgeOrthogonalSegmentsConnectedToShapes: options.nudgeOrthogonalSegmentsConnectedToShapes ?? true,
            nudgeOrthogonalTouchingColinearSegments: options.nudgeOrthogonalTouchingColinearSegments ?? true,
            performUnifyingNudgingPreprocessingStep: options.performUnifyingNudgingPreprocessingStep ?? true,
            nudgeSharedPathsWithCommonEndPoint: options.nudgeSharedPathsWithCommonEndPoint ?? true,
        });
        return new LibavoidRoutingSession(scene, session, options);
    }

    async route(request, options = {}) {
        const scene = request?.scene ?? request;
        return this.routeScene(scene, options);
    }

    get capabilities() {
        return { wasm: true, obstacleAvoidance: true, orthogonal: true, polyline: true, incrementalTransactions: true, nudging: true };
    }
}

export class LibavoidRoutingSession {
    constructor(scene, session, options = {}) {
        this.scene = scene;
        this.session = session;
        this.options = options;
    }

    moveComponent(componentId, positionOrBody) {
        const body = componentBody(this.scene, componentId);
        if (!body)
            return false;
        const x = positionOrBody.x - (positionOrBody.center ? body.width / 2 : 0);
        const y = positionOrBody.y - (positionOrBody.center ? body.height / 2 : 0);
        this.session.moveNode(componentId, { x, y });
        return true;
    }

    addWire(wire) {
        if (wire.source.kind !== 'port' || wire.target.kind !== 'port')
            return false;
        this.session.addEdge({
            id: wire.id,
            source: wire.source.componentId,
            target: wire.target.componentId,
            sourcePort: `${wire.source.componentId}:${wire.source.portId}`,
            targetPort: `${wire.target.componentId}:${wire.target.portId}`,
        });
        return true;
    }

    removeWire(wireId) {
        this.session.removeEdge(wireId);
    }

    processTransaction(revision = this.scene.document.revision) {
        const raw = this.session.processTransaction();
        const routes = new Map();
        for (const [wireId, route] of raw) {
            const radius = this.scene.document.wires[wireId]?.routing?.requestedRadius ?? 0;
            routes.set(wireId, libavoidRouteToEditorRoute(route, revision, radius));
        }
        return routes;
    }

    destroy() {
        this.session.destroy?.();
    }
}

/** Convert external routes to manual constraints in one undoable transaction. */
export function applyExternalRoutesTransaction(engine, routes, options = {}) {
    return engine.execute(options.label ?? 'Apply external routes', (draft, impact) => {
        for (const [wireId, route] of routes) {
            const wire = draft.wires[wireId];
            if (!wire || !route?.points?.length)
                continue;
            wire.routing.pattern = 'manual';
            wire.routing.constraints = route.points.slice(1, -1).map((point, index) =>
                createWaypointConstraint(`${wireId}:external:${index + 1}`, point, options.locked ?? true));
            impact.reroutedWires.push(wireId);
        }
    });
}

export function createLibavoidWasmBackend(options) {
    return new LibavoidWasmBackend(options);
}
