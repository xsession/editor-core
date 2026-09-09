import { canConnectPorts } from './document.js';
import { dot, normalize, screenToleranceToWorld, subtract } from './geometry.js';
import { routeWire } from './routing.js';

function findPort(document, endpoint) {
    return document.components[endpoint.componentId]?.ports?.find((port) => port.id === endpoint.portId);
}

function classAffinity(sourceClass, targetClass) {
    const strongPairs = new Set([
        'signal-output>signal-input',
        'power-output>power-input',
        'bidirectional>bidirectional',
        'ground>ground',
        'shield>shield',
        'passive>passive',
    ]);
    if (strongPairs.has(`${sourceClass}>${targetClass}`))
        return 1;
    if (sourceClass === 'unknown' || targetClass === 'unknown')
        return 0.25;
    if (sourceClass === 'bidirectional' || targetClass === 'bidirectional')
        return 0.65;
    return sourceClass === targetClass ? 0.45 : 0;
}

function facingAffinity(sourceGeometry, targetGeometry) {
    if (!sourceGeometry || !targetGeometry)
        return 0;
    const sourceToTarget = normalize(subtract(targetGeometry.center, sourceGeometry.center));
    const targetToSource = { x: -sourceToTarget.x, y: -sourceToTarget.y };
    const sourceFacing = Math.max(0, dot(normalize(sourceGeometry.normal), sourceToTarget));
    const targetFacing = Math.max(0, dot(normalize(targetGeometry.normal), targetToSource));
    return (sourceFacing + targetFacing) / 2;
}

function candidateKey(componentId, portId) {
    return `${componentId}:${portId}`;
}

/**
 * Finds nearby port magnets and ranks them by screen-space distance,
 * electrical compatibility, port facing and connection validity.
 */
export function findConnectionCandidates(document, sourceEndpoint, pointer, context, spatialIndex, options = {}) {
    const zoom = Math.max(context.zoom ?? 1, 0.0001);
    const snapRadiusPx = options.snapRadiusPx ?? 18;
    const radius = screenToleranceToWorld(snapRadiusPx, zoom);
    const items = spatialIndex.queryPoint(pointer, radius);
    const seen = new Set();
    const results = [];
    const sourcePort = sourceEndpoint?.kind === 'port' ? findPort(document, sourceEndpoint) : undefined;
    const sourceGeometry = sourceEndpoint?.kind === 'port'
        ? context.componentGeometries[sourceEndpoint.componentId]?.ports?.[sourceEndpoint.portId]
        : undefined;

    for (const item of items) {
        if (item.value?.kind !== 'port')
            continue;
        const componentId = item.value.id;
        const portId = item.value.subId;
        const key = candidateKey(componentId, portId);
        if (seen.has(key))
            continue;
        seen.add(key);
        if (sourceEndpoint?.kind === 'port' && sourceEndpoint.componentId === componentId && sourceEndpoint.portId === portId)
            continue;

        const targetEndpoint = { kind: 'port', componentId, portId };
        const targetPort = findPort(document, targetEndpoint);
        const targetGeometry = context.componentGeometries[componentId]?.ports?.[portId];
        if (!targetPort || !targetGeometry)
            continue;

        let check = { valid: true, reasons: [] };
        if (sourceEndpoint?.kind === 'port')
            check = canConnectPorts(document, sourceEndpoint, targetEndpoint, options.wireKind ?? 'discrete');
        if (!check.valid && options.includeInvalid !== true)
            continue;

        const worldDistance = Math.hypot(pointer.x - targetGeometry.center.x, pointer.y - targetGeometry.center.y);
        const distancePx = worldDistance * zoom;
        const facing = facingAffinity(sourceGeometry, targetGeometry);
        const electrical = sourcePort ? classAffinity(sourcePort.electricalClass, targetPort.electricalClass) : 0.25;
        const invalidPenalty = check.valid ? 0 : 1000;
        const score = distancePx - facing * (options.facingWeight ?? 6) - electrical * (options.electricalWeight ?? 8) + invalidPenalty;

        results.push({
            endpoint: targetEndpoint,
            componentId,
            portId,
            point: { ...targetGeometry.center },
            distancePx,
            facing,
            electricalAffinity: electrical,
            valid: check.valid,
            reasons: check.reasons ?? (check.reason ? [check.reason] : []),
            score,
            port: targetPort,
        });
    }

    results.sort((a, b) => a.score - b.score || a.distancePx - b.distancePx || a.componentId.localeCompare(b.componentId) || String(a.portId).localeCompare(String(b.portId)));
    return results.slice(0, options.limit ?? 8);
}

/**
 * Stateful magnetic snapping with acquisition/release hysteresis. This avoids
 * connection targets flickering when the pointer sits near two adjacent pins.
 */
export class MagneticConnectionSession {
    active;
    sourceEndpoint;
    options;

    constructor(sourceEndpoint, options = {}) {
        this.sourceEndpoint = sourceEndpoint;
        this.options = options;
    }

    update(pointer, document, context, spatialIndex) {
        const zoom = Math.max(context.zoom ?? 1, 0.0001);
        const acquirePx = this.options.snapRadiusPx ?? 18;
        const releasePx = this.options.releaseRadiusPx ?? acquirePx * 1.55;
        if (this.active) {
            const geometry = context.componentGeometries[this.active.componentId]?.ports?.[this.active.portId];
            if (geometry) {
                const distancePx = Math.hypot(pointer.x - geometry.center.x, pointer.y - geometry.center.y) * zoom;
                if (distancePx <= releasePx) {
                    return {
                        candidate: this.active,
                        snappedPoint: { ...geometry.center },
                        acquired: false,
                    };
                }
            }
            this.active = undefined;
        }

        const candidates = findConnectionCandidates(
            document,
            this.sourceEndpoint,
            pointer,
            context,
            spatialIndex,
            { ...this.options, snapRadiusPx: acquirePx },
        );
        const next = candidates.find((candidate) => candidate.valid) ?? (this.options.includeInvalid ? candidates[0] : undefined);
        this.active = next;
        return {
            candidate: next,
            snappedPoint: next ? { ...next.point } : { ...pointer },
            acquired: Boolean(next),
        };
    }

    clear() {
        this.active = undefined;
    }
}

/** Creates a routed preview wire using the same router as committed wires. */
export function createConnectionPreview(sourceEndpoint, pointerOrTarget, context, options = {}) {
    const target = pointerOrTarget?.kind
        ? pointerOrTarget
        : { kind: 'free', point: { x: pointerOrTarget.x, y: pointerOrTarget.y } };
    const wire = {
        id: options.id ?? '__connection-preview__',
        kind: options.wireKind ?? 'discrete',
        source: sourceEndpoint,
        target,
        routing: {
            pattern: 'orthogonal',
            clearance: 12,
            grid: 8,
            leadIn: 20,
            requestedRadius: 8,
            minimumSegment: 6,
            bendPenalty: 32,
            crossingPenalty: 100,
            proximityPenalty: 4,
            reversePenalty: 18,
            previousRouteStability: 3,
            maxSearchNodes: options.maxSearchNodes ?? 4000,
            allowCrossings: true,
            preferSharedChannels: false,
            constraints: [],
            ...(options.routing ?? {}),
        },
        style: options.style ?? { width: 2, zIndex: 0 },
        locked: false,
        hidden: false,
    };
    return routeWire(wire, context);
}
