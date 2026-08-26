import { rectBottom, rectRight, rectsIntersect } from './geometry.js';
/**
 * Deterministic uniform-grid index for canvas hit testing and local collision
 * queries. It is deliberately simple, serializable, and dependency-free.
 */
export class UniformGridIndex {
    cellSize;
    buckets = new Map();
    items = new Map();
    constructor(cellSize = 128) {
        this.cellSize = cellSize;
        if (!Number.isFinite(cellSize) || cellSize <= 0)
            throw new Error('cellSize must be a positive number');
    }
    cell(value) {
        return Math.floor(value / this.cellSize);
    }
    key(x, y) {
        return `${x}:${y}`;
    }
    keysFor(bounds) {
        const minimumX = this.cell(bounds.x);
        const minimumY = this.cell(bounds.y);
        const maximumX = this.cell(rectRight(bounds));
        const maximumY = this.cell(rectBottom(bounds));
        const keys = [];
        for (let y = minimumY; y <= maximumY; y += 1) {
            for (let x = minimumX; x <= maximumX; x += 1)
                keys.push(this.key(x, y));
        }
        return keys;
    }
    insert(item) {
        this.remove(item.id);
        this.items.set(item.id, { ...item, bounds: { ...item.bounds } });
        for (const key of this.keysFor(item.bounds)) {
            const bucket = this.buckets.get(key) ?? new Set();
            bucket.add(item.id);
            this.buckets.set(key, bucket);
        }
    }
    remove(id) {
        const existing = this.items.get(id);
        if (!existing)
            return false;
        for (const key of this.keysFor(existing.bounds)) {
            const bucket = this.buckets.get(key);
            if (!bucket)
                continue;
            bucket.delete(id);
            if (bucket.size === 0)
                this.buckets.delete(key);
        }
        this.items.delete(id);
        return true;
    }
    update(item) {
        this.insert(item);
    }
    clear() {
        this.buckets.clear();
        this.items.clear();
    }
    get(id) {
        return this.items.get(id);
    }
    queryRect(bounds) {
        const ids = new Set();
        for (const key of this.keysFor(bounds)) {
            for (const id of this.buckets.get(key) ?? [])
                ids.add(id);
        }
        return [...ids]
            .map((id) => this.items.get(id))
            .filter((item) => rectsIntersect(item.bounds, bounds))
            .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0) || a.id.localeCompare(b.id));
    }
    queryPoint(point, tolerance = 0) {
        return this.queryRect({
            x: point.x - tolerance,
            y: point.y - tolerance,
            width: tolerance * 2,
            height: tolerance * 2,
        });
    }
    all() {
        return [...this.items.values()];
    }
    get size() {
        return this.items.size;
    }
}
import { closestPointOnSegment, distancePointToSegment, polylineIntersectsRect, rectContainsPoint, rectContainsRect, routeBounds, screenToleranceToWorld, } from './geometry.js';
function hitPriority(kind) {
    switch (kind) {
        case 'port':
            return 900;
        case 'route-waypoint':
            return 850;
        case 'route-segment':
            return 800;
        case 'label':
            return 700;
        case 'component-header':
            return 650;
        case 'component-body':
            return 600;
        case 'wire':
            return 500;
        case 'resize-handle':
            return 950;
        case 'rotate-handle':
            return 960;
    }
}
/**
 * Framework-neutral hit testing ordered for direct manipulation: explicit
 * handles and ports win over labels, labels win over component bodies, and a
 * wire's editable segment wins over its broad selection stroke.
 */
export function hitTestDocument(document, point, context) {
    const tolerance = screenToleranceToWorld(context.hitTolerancePx, context.zoom);
    const hits = [];
    for (const componentId of document.componentOrder) {
        const component = document.components[componentId];
        const geometry = context.componentGeometries[componentId];
        if (!component || !geometry || (component.hidden && !context.includeHidden))
            continue;
        const componentZ = document.componentOrder.indexOf(componentId) * 10;
        for (const port of Object.values(geometry.ports)) {
            const inflated = {
                x: port.hitBounds.x - tolerance,
                y: port.hitBounds.y - tolerance,
                width: port.hitBounds.width + tolerance * 2,
                height: port.hitBounds.height + tolerance * 2,
            };
            if (rectContainsPoint(inflated, point)) {
                hits.push({
                    kind: 'port',
                    entityId: componentId,
                    subId: port.portId,
                    distance: Math.hypot(point.x - port.center.x, point.y - port.center.y),
                    zIndex: componentZ + hitPriority('port'),
                    point: port.center,
                });
            }
        }
        if (rectContainsPoint(geometry.headerBounds, point)) {
            hits.push({
                kind: 'component-header',
                entityId: componentId,
                distance: 0,
                zIndex: componentZ + hitPriority('component-header'),
                point,
            });
        }
        else if (rectContainsPoint(geometry.worldBody, point)) {
            hits.push({
                kind: 'component-body',
                entityId: componentId,
                distance: 0,
                zIndex: componentZ + hitPriority('component-body'),
                point,
            });
        }
    }
    for (const placement of context.labelPlacements) {
        const label = document.labels[placement.labelId];
        if (!label || (label.visible === false && !context.includeHidden))
            continue;
        const bounds = {
            x: placement.bounds.x - tolerance,
            y: placement.bounds.y - tolerance,
            width: placement.bounds.width + tolerance * 2,
            height: placement.bounds.height + tolerance * 2,
        };
        if (rectContainsPoint(bounds, point)) {
            hits.push({
                kind: 'label',
                entityId: placement.labelId,
                distance: 0,
                zIndex: 10_000 + label.priority + hitPriority('label'),
                point: placement.position,
            });
        }
    }
    for (const wireId of document.wireOrder) {
        const wire = document.wires[wireId];
        if (!wire?.route || (wire.hidden && !context.includeHidden))
            continue;
        const points = wire.route.points;
        const wireTolerance = tolerance + Math.max(1, wire.style.width / 2);
        if (context.includeRouteHandles) {
            for (let index = 1; index < points.length - 1; index += 1) {
                const waypoint = points[index];
                const distance = Math.hypot(point.x - waypoint.x, point.y - waypoint.y);
                if (distance <= wireTolerance * 1.35) {
                    hits.push({
                        kind: 'route-waypoint',
                        entityId: wire.id,
                        subId: index,
                        distance,
                        zIndex: wire.style.zIndex + hitPriority('route-waypoint'),
                        point: waypoint,
                    });
                }
            }
        }
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestIndex = -1;
        let bestPoint = points[0] ?? point;
        for (let index = 0; index < points.length - 1; index += 1) {
            const start = points[index];
            const end = points[index + 1];
            const distance = distancePointToSegment(point, start, end);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
                bestPoint = closestPointOnSegment(point, start, end);
            }
        }
        if (bestDistance <= wireTolerance) {
            hits.push({
                kind: context.includeRouteHandles ? 'route-segment' : 'wire',
                entityId: wire.id,
                subId: context.includeRouteHandles ? bestIndex : undefined,
                distance: bestDistance,
                zIndex: wire.style.zIndex + hitPriority(context.includeRouteHandles ? 'route-segment' : 'wire'),
                point: bestPoint,
            });
        }
    }
    return hits.sort((a, b) => b.zIndex - a.zIndex || a.distance - b.distance || a.entityId.localeCompare(b.entityId));
}
/** Selects components, wires and labels using CAD-style window/crossing rules. */
export function marqueeSelect(document, bounds, mode, context) {
    const selected = [];
    const matches = (candidate) => mode === 'window' ? rectContainsRect(bounds, candidate) : rectsIntersect(bounds, candidate);
    for (const componentId of document.componentOrder) {
        const component = document.components[componentId];
        const geometry = context.componentGeometries[componentId];
        if (!component || !geometry || (component.hidden && !context.includeHidden))
            continue;
        if (matches(geometry.worldBounds))
            selected.push({ kind: 'component', id: componentId });
    }
    for (const wireId of document.wireOrder) {
        const wire = document.wires[wireId];
        if (!wire?.route || (wire.hidden && !context.includeHidden))
            continue;
        const isMatch = mode === 'window'
            ? rectContainsRect(bounds, routeBounds(wire.route.points, wire.style.width / 2))
            : polylineIntersectsRect(wire.route.points, bounds);
        if (isMatch)
            selected.push({ kind: 'wire', id: wireId });
    }
    for (const placement of context.labelPlacements) {
        const label = document.labels[placement.labelId];
        if (!label || (!label.visible && !context.includeHidden))
            continue;
        if (matches(placement.bounds))
            selected.push({ kind: 'label', id: placement.labelId });
    }
    return selected;
}
//# sourceMappingURL=spatial.js.map