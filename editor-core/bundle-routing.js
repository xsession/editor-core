import { simplifyPolyline } from './geometry.js';

function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Stable multi-wire lane router for harnesses/buses. It assigns parallel
 * orthogonal channels and keeps an optional previous lane assignment so minor
 * edits do not cause the whole bundle to visually reshuffle.
 */
export function routeWireBundle(members, options = {}) {
    if (members.length === 0)
        return { routes: new Map(), lanes: new Map(), orientation: options.orientation ?? 'horizontal' };
    const dx = Math.max(...members.map((member) => member.target.x)) - Math.min(...members.map((member) => member.source.x));
    const dy = Math.max(...members.map((member) => member.target.y)) - Math.min(...members.map((member) => member.source.y));
    const orientation = options.orientation === 'auto' || !options.orientation
        ? (Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical')
        : options.orientation;
    const laneSpacing = options.laneSpacing ?? 10;
    const previous = options.previousLanes ?? new Map();
    const perpendicular = (member) => orientation === 'horizontal'
        ? (member.source.y + member.target.y) / 2
        : (member.source.x + member.target.x) / 2;
    const ordered = [...members].sort((a, b) => {
        const aPrev = previous.get(a.id);
        const bPrev = previous.get(b.id);
        if (aPrev !== undefined && bPrev !== undefined && aPrev !== bPrev)
            return aPrev - bPrev;
        return perpendicular(a) - perpendicular(b) || String(a.id).localeCompare(String(b.id));
    });
    const center = options.centerCoordinate ?? median(ordered.flatMap((member) => orientation === 'horizontal'
        ? [member.source.y, member.target.y]
        : [member.source.x, member.target.x]));
    const routes = new Map();
    const lanes = new Map();
    for (let index = 0; index < ordered.length; index += 1) {
        const member = ordered[index];
        const lane = index - (ordered.length - 1) / 2;
        const coordinate = center + lane * laneSpacing;
        lanes.set(member.id, coordinate);
        const points = orientation === 'horizontal'
            ? [member.source, { x: member.source.x, y: coordinate }, { x: member.target.x, y: coordinate }, member.target]
            : [member.source, { x: coordinate, y: member.source.y }, { x: coordinate, y: member.target.y }, member.target];
        routes.set(member.id, simplifyPolyline(points));
    }
    return { routes, lanes, orientation };
}

/** Converts a lane result into strong corridor constraints for the core router. */
export function bundleLaneConstraints(bundleResult, options = {}) {
    const constraints = new Map();
    const strength = options.strength ?? 'strong';
    for (const [wireId, coordinate] of bundleResult.lanes) {
        constraints.set(wireId, [{
            id: `bundle-lane:${wireId}`,
            kind: bundleResult.orientation === 'horizontal' ? 'corridor-horizontal' : 'corridor-vertical',
            coordinate,
            strength,
            ownerFrame: 'world',
            metadata: { generatedBy: 'routeWireBundle' },
        }]);
    }
    return constraints;
}
