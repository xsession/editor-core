import {
    inflateRect,
    lineSegmentsCross,
    polylineIntersectsRect,
    rectsIntersect,
    routeBounds,
} from './geometry.js';
import { resolveEndpoint, routeWire } from './routing.js';
import { UniformGridIndex } from './spatial.js';

function segmentBounds(start, end, padding = 0) {
    return {
        x: Math.min(start.x, end.x) - padding,
        y: Math.min(start.y, end.y) - padding,
        width: Math.abs(end.x - start.x) + padding * 2,
        height: Math.abs(end.y - start.y) + padding * 2,
    };
}

function endpointBounds(a, b, margin) {
    return inflateRect({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
    }, margin);
}

function uniqueById(items) {
    const map = new Map();
    for (const item of items)
        map.set(item.id, item);
    return [...map.values()];
}

/**
 * Broad-phase index used by local routing. Obstacles and route segments are
 * indexed separately so routing cost scales with nearby geometry instead of
 * the whole document in the common case.
 */
export class RoutingSpatialAccelerator {
    obstacleIndex;
    routeSegmentIndex;
    obstacles = new Map();
    routes = new Map();
    routeSegmentIds = new Map();
    revision = -1;

    constructor(cellSize = 192) {
        this.obstacleIndex = new UniformGridIndex(cellSize);
        this.routeSegmentIndex = new UniformGridIndex(cellSize);
    }

    clear() {
        this.obstacleIndex.clear();
        this.routeSegmentIndex.clear();
        this.obstacles.clear();
        this.routes.clear();
        this.routeSegmentIds.clear();
        this.revision = -1;
    }

    rebuild(obstacles = [], existingRoutes = [], revision = -1) {
        this.clear();
        for (const obstacle of obstacles)
            this.upsertObstacle(obstacle);
        for (const route of existingRoutes)
            this.upsertRoute(route);
        this.revision = revision;
        return this;
    }

    upsertObstacle(obstacle) {
        this.removeObstacle(obstacle.id);
        const stored = { ...obstacle, rect: { ...obstacle.rect } };
        this.obstacles.set(obstacle.id, stored);
        this.obstacleIndex.insert({
            id: `obstacle:${obstacle.id}`,
            bounds: stored.rect,
            value: stored,
        });
        return this;
    }

    removeObstacle(id) {
        this.obstacleIndex.remove(`obstacle:${id}`);
        return this.obstacles.delete(id);
    }

    upsertRoute(route) {
        this.removeRoute(route.wireId);
        const stored = {
            wireId: route.wireId,
            points: route.points.map((point) => ({ ...point })),
            zIndex: route.zIndex,
        };
        this.routes.set(route.wireId, stored);
        const ids = [];
        for (let index = 0; index < stored.points.length - 1; index += 1) {
            const id = `route-segment:${route.wireId}:${index}`;
            ids.push(id);
            this.routeSegmentIndex.insert({
                id,
                bounds: segmentBounds(stored.points[index], stored.points[index + 1]),
                value: { wireId: route.wireId, segmentIndex: index },
            });
        }
        this.routeSegmentIds.set(route.wireId, ids);
        return this;
    }

    removeRoute(wireId) {
        for (const id of this.routeSegmentIds.get(wireId) ?? [])
            this.routeSegmentIndex.remove(id);
        this.routeSegmentIds.delete(wireId);
        return this.routes.delete(wireId);
    }

    obstaclesIn(bounds, padding = 0) {
        const query = padding > 0 ? inflateRect(bounds, padding) : bounds;
        return this.obstacleIndex.queryRect(query).map((item) => item.value);
    }

    routesIn(bounds, excludeWireId) {
        const ids = new Set();
        for (const item of this.routeSegmentIndex.queryRect(bounds)) {
            const wireId = item.value.wireId;
            if (wireId !== excludeWireId)
                ids.add(wireId);
        }
        return [...ids].map((id) => this.routes.get(id)).filter(Boolean);
    }

    routeObstacleViolations(points, sourceComponentId, targetComponentId, clearance = 0) {
        const violations = new Set();
        if (!points || points.length < 2)
            return [];
        for (let index = 0; index < points.length - 1; index += 1) {
            const segment = segmentBounds(points[index], points[index + 1], clearance);
            for (const item of this.obstacleIndex.queryRect(segment)) {
                const obstacle = item.value;
                if (obstacle.soft)
                    continue;
                const endpointComponent = obstacle.id === sourceComponentId || obstacle.id === targetComponentId;
                if (endpointComponent && (index === 0 || index === points.length - 2))
                    continue;
                const inflated = inflateRect(obstacle.rect, obstacle.kind === 'keepout' ? 0 : clearance);
                if (polylineIntersectsRect([points[index], points[index + 1]], inflated))
                    violations.add(obstacle.id);
            }
        }
        return [...violations];
    }

    get stats() {
        return {
            obstacles: this.obstacles.size,
            routes: this.routes.size,
            routeSegments: this.routeSegmentIndex.size,
        };
    }
}

/**
 * Runs the existing deterministic router with a local subset of obstacles and
 * routes, then verifies the result against the global index. Search locality
 * grows geometrically and ultimately falls back to the full context, so the
 * optimization does not trade away correctness.
 */
export function routeWireAccelerated(wire, context, accelerator, options = {}) {
    const source = resolveEndpoint(wire.source, context.componentGeometries);
    const target = resolveEndpoint(wire.target, context.componentGeometries);
    if (!source || !target)
        return routeWire(wire, context);

    const routing = wire.routing ?? {};
    const clearance = routing.clearance ?? 12;
    const leadIn = routing.leadIn ?? 20;
    const baseMargin = options.initialMargin ?? Math.max(128, clearance * 8, leadIn * 4);
    const attempts = Math.max(1, options.attempts ?? 3);
    const growth = Math.max(1.25, options.growth ?? 2);

    let margin = baseMargin;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const searchBounds = endpointBounds(source.point, target.point, margin);
        const localObstacles = accelerator.obstaclesIn(searchBounds, clearance);
        const localRoutes = accelerator.routesIn(searchBounds, wire.id);
        const result = routeWire(wire, {
            ...context,
            obstacles: localObstacles,
            existingRoutes: localRoutes,
        });
        const violations = accelerator.routeObstacleViolations(
            result.points,
            source.componentId,
            target.componentId,
            clearance,
        );
        if (violations.length === 0 && result.status !== 'invalid') {
            if (attempt > 0) {
                result.diagnostics = [
                    ...(result.diagnostics ?? []),
                    `Local routing converged after ${attempt + 1} search windows.`,
                ];
            }
            return result;
        }
        margin *= growth;
    }

    const result = routeWire(wire, context);
    if (options.annotateFallback !== false) {
        result.diagnostics = [
            ...(result.diagnostics ?? []),
            'Local routing fell back to the full routing context.',
        ];
    }
    return result;
}

/**
 * Spatially accelerated crossing detection. The original implementation is
 * pairwise across all wires and all route segments; this version only compares
 * segment pairs whose bounding boxes overlap.
 */
export function findWireCrossingsIndexed(wires, options = {}) {
    const visible = wires.filter((wire) => wire?.route?.points?.length >= 2 && !wire.hidden);
    const index = new UniformGridIndex(options.cellSize ?? 192);
    const segments = [];
    for (let wireOrder = 0; wireOrder < visible.length; wireOrder += 1) {
        const wire = visible[wireOrder];
        for (let segmentIndex = 0; segmentIndex < wire.route.points.length - 1; segmentIndex += 1) {
            const segment = {
                id: `${wire.id}:${segmentIndex}`,
                wire,
                wireOrder,
                segmentIndex,
                start: wire.route.points[segmentIndex],
                end: wire.route.points[segmentIndex + 1],
            };
            segments.push(segment);
            index.insert({
                id: segment.id,
                bounds: segmentBounds(segment.start, segment.end),
                value: segment,
            });
        }
    }

    const crossings = [];
    const seen = new Set();
    const precision = options.dedupePrecision ?? 1e-6;
    const quantize = (value) => Math.round(value / precision);

    for (const segment of segments) {
        const bounds = segmentBounds(segment.start, segment.end);
        for (const candidate of index.queryRect(bounds)) {
            const other = candidate.value;
            if (other.wire.id === segment.wire.id)
                continue;
            if (other.wireOrder < segment.wireOrder ||
                (other.wireOrder === segment.wireOrder && other.segmentIndex <= segment.segmentIndex))
                continue;
            const point = lineSegmentsCross(segment.start, segment.end, other.start, other.end);
            if (!point)
                continue;
            const wireA = segment.wire.id;
            const wireB = other.wire.id;
            const pair = wireA < wireB ? `${wireA}|${wireB}` : `${wireB}|${wireA}`;
            const key = `${pair}|${quantize(point.x)}:${quantize(point.y)}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            const overWire = (segment.wire.style?.zIndex ?? 0) >= (other.wire.style?.zIndex ?? 0)
                ? wireA
                : wireB;
            crossings.push({
                point,
                wireA,
                wireB,
                overWire,
                underWire: overWire === wireA ? wireB : wireA,
            });
        }
    }
    return crossings;
}

/**
 * Revision-aware coordinator for expensive worker/WASM routing backends. A
 * stale response is ignored automatically when a newer request for the same
 * wire has already been submitted.
 */
export class AsyncRoutingCoordinator {
    sequence = 0;
    latestByWire = new Map();

    async route(wireId, revision, backend, request, options = {}) {
        if (!backend || typeof backend.route !== 'function')
            throw new Error('AsyncRoutingCoordinator requires a backend with route(request, options).');
        const token = ++this.sequence;
        this.latestByWire.set(wireId, { token, revision });
        const result = await backend.route(request, options);
        const latest = this.latestByWire.get(wireId);
        const stale = !latest || latest.token !== token || latest.revision !== revision;
        return { stale, wireId, revision, token, result };
    }

    invalidate(wireId) {
        this.latestByWire.delete(wireId);
    }

    clear() {
        this.latestByWire.clear();
    }
}

/**
 * Returns a compact set of route ids that overlap a dirty region. Useful for
 * rerouting wires affected by moved obstacles even when they are not directly
 * connected to the moved component.
 */
export function routesIntersectingRegion(accelerator, bounds) {
    return [...new Set(accelerator.routesIn(bounds).map((route) => route.wireId))];
}
