function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
function circumradius(a, b, c) {
    const ab = distance(a, b);
    const bc = distance(b, c);
    const ac = distance(a, c);
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (cross < 1e-9 || ab < 1e-9 || bc < 1e-9 || ac < 1e-9)
        return Number.POSITIVE_INFINITY;
    return (ab * bc * ac) / (2 * cross);
}
function wireColor(wire) {
    const pattern = wire.style.pattern;
    if (pattern.kind === 'solid')
        return pattern.color;
    if (pattern.kind === 'dual')
        return pattern.primary;
    if (pattern.kind === 'shield')
        return pattern.core || pattern.sheath;
    if (pattern.kind === 'custom')
        return pattern.layers[0]?.color || '#3b82f6';
    return pattern.base;
}
function defaultPathPoints(document, wireId) {
    const wire = document.wires[wireId];
    if (wire?.route?.points?.length)
        return wire.route.points;
    const endpoint = (value) => {
        if (value.kind === 'free' || value.kind === 'off-page')
            return value.point;
        const component = value.kind === 'port' ? document.components[value.componentId] : undefined;
        return component?.position || { x: 0, y: 0 };
    };
    return [endpoint(wire.source), endpoint(wire.target)];
}
export function createSpatialHarnessDocument(document, previous) {
    const next = previous ? structuredClone(previous) : { version: 1, unit: 'mm', cables: {}, cableOrder: [], viewpoints: [] };
    const active = new Set(document.wireOrder);
    next.cableOrder = document.wireOrder;
    for (const wireId of document.wireOrder) {
        const wire = document.wires[wireId];
        if (!wire)
            continue;
        const existing = next.cables[wireId];
        next.cables[wireId] = existing || {
            id: `spatial-${wireId}`,
            wireId,
            label: wire.label || wire.signal || wireId,
            diameterMm: Math.max(1, Number(wire.metadata?.diameterMm || wire.style.width || 2)),
            minimumBendRadiusMm: Math.max(1, Number(wire.metadata?.minimumBendRadiusMm || 12)),
            color: wireColor(wire),
            controlPoints: defaultPathPoints(document, wireId).map((point, index, points) => ({ x: point.x, y: index === 0 || index === points.length - 1 ? 0 : 15, z: point.y })),
            lockedPointIndices: [0, Math.max(0, defaultPathPoints(document, wireId).length - 1)],
            surfaceMode: 'free',
        };
        next.cables[wireId].label = wire.label || wire.signal || wireId;
        next.cables[wireId].color = wireColor(wire);
    }
    for (const id of Object.keys(next.cables))
        if (!active.has(id))
            delete next.cables[id];
    return next;
}
export function analyzeSpatialCable(path) {
    let lengthMm = 0;
    let minimumObservedBendRadiusMm = Number.POSITIVE_INFINITY;
    const bendViolations = [];
    for (let index = 1; index < path.controlPoints.length; index += 1)
        lengthMm += distance(path.controlPoints[index - 1], path.controlPoints[index]);
    for (let index = 1; index < path.controlPoints.length - 1; index += 1) {
        const radiusMm = circumradius(path.controlPoints[index - 1], path.controlPoints[index], path.controlPoints[index + 1]);
        minimumObservedBendRadiusMm = Math.min(minimumObservedBendRadiusMm, radiusMm);
        if (radiusMm + 1e-6 < path.minimumBendRadiusMm)
            bendViolations.push({ pointIndex: index, radiusMm, requiredMm: path.minimumBendRadiusMm });
    }
    return {
        lengthMm,
        minimumObservedBendRadiusMm: Number.isFinite(minimumObservedBendRadiusMm) ? minimumObservedBendRadiusMm : null,
        bendViolations,
        valid: path.controlPoints.length >= 2 && bendViolations.length === 0,
    };
}
export function insertSpatialControlPoint(path, afterIndex) {
    const next = structuredClone(path);
    const index = Math.max(0, Math.min(next.controlPoints.length - 2, afterIndex));
    const a = next.controlPoints[index];
    const b = next.controlPoints[index + 1];
    next.controlPoints.splice(index + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    next.lockedPointIndices = next.lockedPointIndices.map((value) => value > index ? value + 1 : value);
    return next;
}
//# sourceMappingURL=spatial-harness.js.map