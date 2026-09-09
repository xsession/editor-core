import { roundedOrthogonalPath } from './geometry.js';

function fmt(value) {
    if (!Number.isFinite(value))
        return '0';
    const rounded = Math.round(value * 1000) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pointOnSegment(point, start, end, epsilon = 1e-6) {
    const minX = Math.min(start.x, end.x) - epsilon;
    const maxX = Math.max(start.x, end.x) + epsilon;
    const minY = Math.min(start.y, end.y) - epsilon;
    const maxY = Math.max(start.y, end.y) + epsilon;
    const cross = (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
    return Math.abs(cross) <= epsilon && point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

export function polylineConnectorPath(points) {
    if (!points?.length)
        return '';
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} ${points.slice(1).map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`).join(' ')}`;
}

/** Catmull-Rom-like cubic smoothing through the route points. */
export function smoothConnectorPath(points, tension = 0.2) {
    if (!points?.length)
        return '';
    if (points.length < 3)
        return polylineConnectorPath(points);
    const commands = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
    const t = Math.max(0, Math.min(0.5, tension));
    for (let index = 0; index < points.length - 1; index += 1) {
        const p0 = points[Math.max(0, index - 1)];
        const p1 = points[index];
        const p2 = points[index + 1];
        const p3 = points[Math.min(points.length - 1, index + 2)];
        const c1 = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t };
        const c2 = { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t };
        commands.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`);
    }
    return commands.join(' ');
}

/**
 * Draws bridge arcs only where this wire is the designated over-wire. This
 * separates routing topology from connector appearance, similar to modern
 * diagram libraries that expose routers and connectors independently.
 */
export function jumpOverConnectorPath(points, crossings, wireId, radius = 5) {
    if (!points?.length)
        return '';
    const commands = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
    const relevant = (crossings ?? []).filter((crossing) => crossing.overWire === wireId);
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length <= 1e-9) {
            continue;
        }
        const ux = dx / length;
        const uy = dy / length;
        const segmentCrossings = relevant
            .map((crossing) => crossing.point)
            .filter((point) => pointOnSegment(point, start, end))
            .map((point) => ({ point, distance: (point.x - start.x) * ux + (point.y - start.y) * uy }))
            .filter((entry) => entry.distance > radius * 1.25 && entry.distance < length - radius * 1.25)
            .sort((a, b) => a.distance - b.distance);
        let cursor = 0;
        for (const entry of segmentCrossings) {
            const beforeDistance = Math.max(cursor, entry.distance - radius);
            const afterDistance = Math.min(length, entry.distance + radius);
            const before = { x: start.x + ux * beforeDistance, y: start.y + uy * beforeDistance };
            const after = { x: start.x + ux * afterDistance, y: start.y + uy * afterDistance };
            commands.push(`L ${fmt(before.x)} ${fmt(before.y)}`);
            commands.push(`A ${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(after.x)} ${fmt(after.y)}`);
            cursor = afterDistance;
        }
        commands.push(`L ${fmt(end.x)} ${fmt(end.y)}`);
    }
    return commands.join(' ');
}

export class ConnectorPathRegistry {
    connectors = new Map();

    constructor() {
        this.register('polyline', (points) => polylineConnectorPath(points));
        this.register('rounded', (points, options = {}) => roundedOrthogonalPath(points, options.radius ?? 8).path);
        this.register('smooth', (points, options = {}) => smoothConnectorPath(points, options.tension ?? 0.2));
        this.register('jump-over', (points, options = {}) => jumpOverConnectorPath(points, options.crossings ?? [], options.wireId, options.radius ?? 5));
    }

    register(name, connector) {
        if (!name || typeof connector !== 'function')
            throw new Error('ConnectorPathRegistry.register requires a name and function.');
        this.connectors.set(name, connector);
        return this;
    }

    build(name, points, options = {}) {
        const connector = this.connectors.get(name);
        if (!connector)
            throw new Error(`Unknown connector path strategy: ${name}`);
        return connector(points, options);
    }
}
